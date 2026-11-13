import { BadRequestException, Body, Controller, Get, Injectable, Logger, Post } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import OpenAI from 'openai';
import { DataSource } from 'typeorm';
import { AuthUser, CurrentUser, Roles } from './auth';
import { KnowledgeChunk, KnowledgeDoc, Product, QaLog, Shipment } from './entities';
import { normalizePhone } from './rules';
import { StockService, productLabel } from './stock';

export const NOT_FOUND_ANSWER = '자료에 없음 — 확인 필요';

@Injectable()
export class AiService {
  private log = new Logger('AI');
  private client: OpenAI | null = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 40000 }) : null;
  model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  embedModel = process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small';

  get enabled() {
    return !!this.client;
  }

  async json(system: string, user: string): Promise<any> {
    if (!this.client) throw new Error('OPENAI_API_KEY 없음');
    const r = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    return JSON.parse(r.choices[0].message.content || '{}');
  }

  async embed(texts: string[]): Promise<number[][] | null> {
    if (!this.client) return null;
    try {
      const r = await this.client.embeddings.create({ model: this.embedModel, input: texts });
      return r.data.map((d) => d.embedding);
    } catch (e: any) {
      this.log.warn(`임베딩 실패 → 키워드 검색으로 대체: ${e.message}`);
      return null;
    }
  }
}

function cosine(a: number[], b: number[]) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** 임베딩을 못 쓸 때 대체: 한글 2글자 묶음 겹침 비율 */
const STOP = new Set(['해요', '나요', '어요', '하나', '하면', '에서', '으로', '어야', '되나', '있어', '까요', '세요', '주세', '는데', '이에', '인가']);
function bigrams(s: string) {
  const t = s.replace(/[^가-힣a-zA-Z0-9]/g, '');
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); if (!STOP.has(g)) out.add(g); }
  return out;
}
function keywordScore(q: string, text: string) {
  const a = bigrams(q), b = bigrams(text);
  if (!a.size) return 0;
  let hit = 0;
  a.forEach((g) => b.has(g) && hit++);
  return hit / a.size;
}

@Injectable()
export class QaService {
  minScore = Number(process.env.QA_MIN_SCORE || 0.25);
  minKeyword = 0.34;
  constructor(@InjectDataSource() private ds: DataSource, private ai: AiService) {}

  private async search(question: string, source: 'farm_note' | 'center', qEmb: number[] | null) {
    const chunks = await this.ds
      .getRepository(KnowledgeChunk)
      .createQueryBuilder('c')
      .addSelect('c.embedding')
      .innerJoinAndSelect('c.doc', 'd')
      .where('d.source = :source', { source })
      .getMany();
    const scored = chunks
      .map((c) => {
        const kw = keywordScore(question, `${c.doc.title} ${c.doc.variety || ''} ${c.content}`);
        // 임베딩 유사도 + 낱말 겹침 보정 (짧은 쪽지 문단이 묻히지 않게)
        const score = qEmb && c.embedding ? cosine(qEmb, c.embedding) + 0.15 * kw : kw;
        const min = source === 'farm_note' ? this.minScore - 0.05 : this.minScore; // 쪽지는 후보를 더 넓게
        const pass = qEmb && c.embedding ? score >= min : score >= this.minKeyword;
        return { c, score, pass };
      })
      .filter((x) => x.pass)
      .sort((a, b) => b.score - a.score)
      .slice(0, source === 'farm_note' ? 5 : 4); // 후보는 넉넉히, 실제 근거 여부는 GPT 답변 + 서버 검증으로 판정
    return scored.map(({ c, score }) => ({
      id: c.id,
      source: c.doc.source,
      sourceLabel: c.doc.source === 'farm_note' ? '농원 쪽지' : '농업기술센터 자료',
      title: c.doc.title,
      variety: c.doc.variety,
      page: c.page,
      content: c.content,
      score: Math.round(score * 100) / 100,
    }));
  }

  private async answerFrom(question: string, sources: any[]) {
    const system = `너는 농산물 직거래 농가 "햇살농원"의 정우 씨가 고객 문의에 답장할 때 돕는 도우미다.
규칙:
- 반드시 아래 [자료]에 적힌 내용만 근거로 답한다. 자료에 없는 사실·숫자·보관 기간·이유를 덧붙이거나 지어내지 않는다. 일반 상식으로 보충하지 않는다.
- 자료가 질문과 같은 작물(사과/배/감자)에 대한 것이면 품종명이 달라도 근거로 쓸 수 있다 (예: "감자" 질문에 "수미 감자" 쪽지).
- 자료로 질문에 답할 수 없으면 found=false 로 한다.
- evidence: 답의 근거가 된 문장을 [자료]에서 글자 그대로 복사한다(고치거나 줄이지 말 것). {"id": 자료 id, "quote": 원문 문장}.
- answer: 정우 씨가 읽을 1~3문장 요약. evidence 문장에 있는 내용만.
- reply_draft: 카카오톡으로 고객에게 보낼 존댓말 답장 2~4문장. "햇살농원입니다"로 시작. evidence 내용만.
JSON 형식: {"found": boolean, "answer": string, "reply_draft": string, "evidence": [{"id": number, "quote": string}]}`;
    const user = `[자료]\n${sources.map((s) => `(id=${s.id}) [${s.sourceLabel}] ${s.title}${s.page ? ` ${s.page}쪽` : ''}\n${s.content}`).join('\n\n')}\n\n[질문]\n${question}`;
    const r = await this.ai.json(system, user);
    // 서버 검증: 인용문이 실제로 그 자료 원문에 있어야 근거로 인정
    const norm = (t: string) => String(t || '').replace(/\s+/g, '').replace(/[.,!?~·"'“”‘’]/g, '');
    const byId = new Map(sources.map((s) => [s.id, s]));
    const evidence = (Array.isArray(r.evidence) ? r.evidence : [])
      .map((e: any) => ({ id: Number(e.id), quote: String(e.quote || '') }))
      .filter((e: any) => byId.has(e.id) && norm(e.quote).length >= 6 && norm(byId.get(e.id).content).includes(norm(e.quote)));
    if (process.env.QA_DEBUG) console.log('[QA]', question, JSON.stringify(r), '→ valid', evidence.length);
    // 원문에서 확인된 인용문이 있어야만 답으로 인정 (GPT의 found 값보다 검증된 인용문을 기준으로)
    if (!evidence.length) return null; // 근거 검증 실패 → 다음 자료 또는 "확인 필요"
    const answer = r.found && r.answer ? String(r.answer) : evidence.map((e: any) => e.quote).join(' ');
    return { answer, replyDraft: String(r.reply_draft || ''), used: [...new Set(evidence.map((e: any) => e.id))] as number[], evidence };
  }

  /** R-12: 쪽지 우선 → 없을 때만 센터 자료 → 둘 다 없으면 AI 호출 없이 "자료에 없음" */
  async ask(question: string, user: AuthUser) {
    const q = (question || '').trim();
    if (q.length < 2) throw new BadRequestException('질문을 입력해 주세요');
    const emb = (await this.ai.embed([q]))?.[0] || null;
    let result: any = null;
    let aiError = false;
    const tried: string[] = [];
    for (const source of ['farm_note', 'center'] as const) {
      const found = await this.search(q, source, emb);
      if (!found.length) continue;
      tried.push(source);
      try {
        const r = await this.answerFrom(q, found);
        if (r) {
          result = {
            found: true,
            answer: r.answer,
            replyDraft: r.replyDraft,
            sources: found.filter((s) => r.used.includes(s.id)).map((s) => ({ ...s, quotes: r.evidence.filter((e: any) => e.id === s.id).map((e: any) => e.quote) })),
            searchedBy: emb ? 'embedding' : 'keyword',
          };
          break;
        }
      } catch (e: any) {
        aiError = true;
        result = { found: true, answer: '답변 생성에 실패했습니다 — 아래 근거를 직접 확인해 주세요', replyDraft: '', sources: found, aiError: true };
        break;
      }
    }
    if (!result) result = { found: false, answer: NOT_FOUND_ANSWER, replyDraft: '', sources: [], tried };
    await this.ds.getRepository(QaLog).save({
      userId: user?.id ?? null,
      question: q,
      answer: result.answer,
      found: result.found && !aiError,
      sourceChunkIds: result.sources.map((s: any) => s.id),
    });
    return result;
  }

  /** 자료 등록: 센터 자료는 "[p.12]" 같은 쪽 표시로 나눈다 */
  async addDoc(b: { source: 'farm_note' | 'center'; title: string; variety?: string; text: string }) {
    if (!['farm_note', 'center'].includes(b.source) || !b.title || !b.text) throw new BadRequestException('자료 종류·제목·내용은 필수');
    const doc = await this.ds.getRepository(KnowledgeDoc).save({ source: b.source, title: b.title, variety: b.variety || null });
    const parts: { page: number | null; content: string }[] = [];
    const re = /\[p\.(\d+)\]/g;
    if (re.test(b.text)) {
      const pieces = b.text.split(/\[p\.(\d+)\]/);
      for (let i = 1; i < pieces.length; i += 2) if (pieces[i + 1]?.trim()) parts.push({ page: Number(pieces[i]), content: pieces[i + 1].trim() });
    } else {
      b.text.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean).forEach((t) => parts.push({ page: null, content: t }));
    }
    const embs = await this.ai.embed(parts.map((p) => `${b.title} ${b.variety || ''}\n${p.content}`));
    for (let i = 0; i < parts.length; i++)
      await this.ds.getRepository(KnowledgeChunk).save({ docId: doc.id, page: parts[i].page, content: parts[i].content, embedding: embs?.[i] || null });
    return { id: doc.id, chunks: parts.length, embedded: !!embs };
  }

  async listDocs() {
    const docs = await this.ds.getRepository(KnowledgeDoc).find({ relations: { chunks: true }, order: { source: 'DESC', id: 'ASC' } });
    return docs.map((d) => {
      const chunks = [...d.chunks].sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || a.id - b.id);
      return {
        id: d.id,
        source: d.source,
        sourceLabel: d.source === 'farm_note' ? '농원 쪽지' : '농업기술센터 자료',
        title: d.title,
        variety: d.variety,
        chunks: chunks.length,
        pages: chunks.map((c) => c.page).filter((p) => p != null),
        content: chunks.map((c) => ({ id: c.id, page: c.page, text: c.content })), // 화면에서 원문 보기
      };
    });
  }
}

@Controller()
export class AiController {
  constructor(private ai: AiService, private qa: QaService, private stock: StockService, @InjectDataSource() private ds: DataSource) {}

  /** AI-1 카톡 주문 정리: 초안만 반환, 저장은 사람이 POST /orders 로 */
  @Post('ai/parse-kakao') @Roles('admin')
  async parseKakao(@Body() b: { text: string }) {
    const text = (b?.text || '').trim();
    if (!text) throw new BadRequestException('카톡 내용을 붙여넣어 주세요');
    const products = (await this.stock.list()).filter((p) => p.active);
    const catalog = products.map((p) => `id=${p.id}: ${p.label}`).join('\n');
    const system = `너는 농가 "햇살농원"의 카카오톡 주문 문장을 주문 초안 JSON으로 정리한다.
규칙:
- 원문에 없는 전화번호·주소·이름·수량을 절대 지어내지 않는다. 없으면 null.
- 상품은 [상품 목록]의 id 중에서만 고른다. 품종·등급·규격이 애매해서 하나로 못 고르면 product_id=null 로 두고 uncertain 에 이유를 적는다.
- "선물용"=선물용, "가정용/집에서 먹을/못난이"=가정용.
- 받는 곳이 여러 곳이면 shipments 를 배송지마다 나눈다. "2박스씩 다섯 군데"면 각 배송지에 2박스.
- 받는 사람이 따로 없으면 주문자 본인에게 보내는 것으로 본다(recipient_name=주문자 이름).
- "작년이랑 같은 걸로", "지난번처럼" 같은 말이 있으면 same_as_last_time=true.
JSON 형식:
{"orderer_name": string|null, "orderer_phone": string|null, "sender_name": string|null, "same_as_last_time": boolean,
 "shipments": [{"recipient_name": string|null, "recipient_phone": string|null, "address": string|null,
   "items": [{"product_id": number|null, "raw_text": string, "qty_boxes": number|null}]}],
 "uncertain": string[]}`;
    let r: any;
    try {
      r = await this.ai.json(system, `[상품 목록]\n${catalog}\n\n[카톡 원문]\n${text}`);
    } catch (e: any) {
      return { ok: false, message: 'AI 정리 실패 — 직접 입력해 주세요', rawText: text };
    }
    // 서버 검증: 상품 id·수량·번호
    const ids = new Set(products.map((p) => p.id));
    const uncertain: string[] = Array.isArray(r.uncertain) ? r.uncertain.map(String) : [];
    const phone = normalizePhone(r.orderer_phone);
    if (r.orderer_phone && !phone) uncertain.push(`주문자 번호 형식 확인 필요: ${r.orderer_phone}`);
    if (!phone) uncertain.push('주문자 전화번호 없음 → "번호 확인 필요"로 저장됩니다');
    const shipments = (Array.isArray(r.shipments) ? r.shipments : []).map((s: any, i: number) => {
      if (!s.address) uncertain.push(`배송지 ${i + 1}: 주소 없음`);
      return {
        recipientName: s.recipient_name || r.orderer_name || '',
        recipientPhone: normalizePhone(s.recipient_phone) || '',
        address: s.address || '',
        items: (Array.isArray(s.items) ? s.items : []).map((it: any) => {
          const okId = ids.has(Number(it.product_id));
          const qty = Number.isInteger(Number(it.qty_boxes)) && Number(it.qty_boxes) > 0 ? Number(it.qty_boxes) : null;
          if (!okId) uncertain.push(`배송지 ${i + 1}: 상품 확인 필요 — "${it.raw_text || ''}"`);
          if (!qty) uncertain.push(`배송지 ${i + 1}: 수량 확인 필요 — "${it.raw_text || ''}"`);
          return { productId: okId ? Number(it.product_id) : null, qtyBoxes: qty, rawText: it.raw_text || '' };
        }),
      };
    });
    let reorderCandidate: any = null;
    if (r.same_as_last_time && phone) {
      const last = await this.ds
        .getRepository(Shipment)
        .createQueryBuilder('s')
        .innerJoin('s.order', 'o')
        .where('o.ordererPhone = :phone', { phone })
        .andWhere(`o.status <> 'cancelled'`)
        .select('o.id', 'orderId')
        .addSelect('o."customerId"', 'customerId')
        .addSelect('o.orderedAt', 'orderedAt')
        .orderBy('o.orderedAt', 'DESC')
        .limit(1)
        .getRawOne();
      reorderCandidate = last || null;
    }
    return {
      ok: true,
      draft: {
        channel: 'kakao',
        ordererName: r.orderer_name || '',
        ordererPhone: phone || '',
        senderName: r.sender_name || r.orderer_name || '',
        rawText: text,
        shipments,
      },
      sameAsLastTime: !!r.same_as_last_time,
      reorderCandidate,
      uncertain: [...new Set(uncertain)],
    };
  }

  @Post('qa/ask') @Roles('admin')
  ask(@Body() b: { question: string }, @CurrentUser() u: AuthUser) {
    return this.qa.ask(b?.question, u);
  }

  @Get('qa/docs') @Roles('admin')
  docs() {
    return this.qa.listDocs();
  }

  @Post('qa/docs') @Roles('admin')
  addDoc(@Body() b: any) {
    return this.qa.addDoc(b);
  }

  /** AI-3 수확·지연 안내 문자 초안 (대상은 서버가 고름, 발송 없음) */
  @Post('ai/notice-draft') @Roles('admin')
  async notice(@Body() b: { varietyId: number; kind: 'harvest' | 'delay'; reason?: string; newDate?: string }) {
    const targets = await this.ds
      .getRepository(Shipment)
      .createQueryBuilder('s')
      .innerJoin('s.order', 'o')
      .innerJoin('s.items', 'i')
      .innerJoin('i.product', 'p')
      .where('p.varietyId = :v', { v: +b.varietyId })
      .andWhere(`s.status = 'pending' AND o.status <> 'cancelled'`)
      .select(['o.id AS "orderId"', 'o.ordererName AS "name"', 'o.ordererPhone AS "phone"'])
      .distinct(true)
      .getRawMany();
    const variety = await this.ds.query('SELECT name FROM varieties WHERE id = $1', [+b.varietyId]);
    if (!variety.length) throw new BadRequestException('품종을 선택해 주세요');
    let draft = '';
    try {
      const r = await this.ai.json(
        `너는 농가 "햇살농원"의 단골 고객(어르신이 많음)에게 보낼 안내 문자 초안을 쓴다. 쉬운 말, 존댓말, 90자 안팎, 이모지 없이. 주어진 날짜·사유 외의 사실을 지어내지 않는다. 고객 이름 자리는 {고객명}. JSON: {"text": string}`,
        `품종: ${variety[0].name}\n안내 종류: ${b.kind === 'delay' ? '수확·발송 지연' : '수확 시작'}\n사유: ${b.reason || '없음'}\n새 발송 예정일: ${b.newDate || '미정'}`,
      );
      draft = String(r.text || '');
    } catch {
      draft = '';
    }
    return { targets, draft, message: draft ? '' : 'AI 초안 생성 실패 — 직접 작성해 주세요' };
  }
}

export { Product, productLabel };

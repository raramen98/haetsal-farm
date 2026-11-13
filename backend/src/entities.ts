import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export type Role = 'admin' | 'packer' | 'stock';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn() id: number;
  @Column({ unique: true }) loginId: string;
  @Column() passwordHash: string;
  @Column() name: string;
  @Column({ type: 'varchar' }) role: Role;
}

@Entity('customers')
export class Customer {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ length: 11 }) phone: string;
  @Column() displayName: string;
  @Column('text', { array: true, default: '{}' }) knownNames: string[];
  @Column({ type: 'varchar', nullable: true }) splitNote: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @OneToMany(() => Order, (o) => o.customer) orders: Order[];
}

@Entity('varieties')
export class Variety {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'varchar' }) crop: '사과' | '배' | '감자';
  @Column() name: string;
  @Column({ type: 'date' }) saleStartDate: string;
  @OneToMany(() => Product, (p) => p.variety) products: Product[];
}

@Entity('products')
@Unique(['varietyId', 'grade', 'boxKg'])
export class Product {
  @PrimaryGeneratedColumn() id: number;
  @Column() varietyId: number;
  @ManyToOne(() => Variety, (v) => v.products, { eager: true })
  @JoinColumn({ name: 'varietyId' })
  variety: Variety;
  @Column({ type: 'varchar' }) grade: 'gift' | 'home';
  @Column('numeric', { transformer: { to: (v) => v, from: (v) => (v == null ? v : Number(v)) } }) boxKg: number;
  @Column('int') price: number;
  @Column('int', { default: 0 }) expectedHarvestBoxes: number;
  @Column('numeric', { precision: 3, scale: 2, default: 0.7, transformer: { to: (v) => v, from: (v) => (v == null ? v : Number(v)) } })
  safetyRatio: number;
  @Column('int', { nullable: true }) actualHarvestBoxes: number | null;
  @Column({ default: false }) allowFriday: boolean;
  @Column({ default: true }) active: boolean;
}

export type Channel = 'smartstore' | 'kakao' | 'phone';
export type OrderStatus = 'needs_check' | 'confirmed' | 'cancelled';
export type DuplicateStatus = 'none' | 'suspect' | 'kept' | 'merged';

@Entity('orders')
@Unique(['channel', 'externalOrderNo'])
export class Order {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'varchar' }) channel: Channel;
  @Column({ type: 'varchar', nullable: true }) externalOrderNo: string | null;
  @Column({ type: 'int', nullable: true }) customerId: number | null;
  @ManyToOne(() => Customer, (c) => c.orders, { nullable: true })
  @JoinColumn({ name: 'customerId' })
  customer: Customer | null;
  @Column() ordererName: string;
  @Column({ type: 'varchar', length: 11, nullable: true }) ordererPhone: string | null;
  @Column({ default: false }) nameMismatch: boolean;
  @Column() senderName: string;
  @Column({ type: 'varchar', default: 'confirmed' }) status: OrderStatus;
  @Column({ default: false }) isReservation: boolean;
  @Column({ type: 'varchar' }) paymentMethod: 'prepaid' | 'cash';
  @Column({ type: 'varchar' }) paymentStatus: 'paid' | 'pending';
  @Column('int', { default: 0 }) totalAmount: number;
  @Column({ type: 'varchar', nullable: true }) depositorName: string | null;
  @Column({ type: 'timestamptz', nullable: true }) paidConfirmedAt: Date | null;
  @Column({ type: 'int', nullable: true }) paidConfirmedBy: number | null;
  @Column({ type: 'varchar', default: 'none' }) duplicateStatus: DuplicateStatus;
  @Column({ type: 'int', nullable: true }) duplicateOfId: number | null;
  @Column({ type: 'text', nullable: true }) rawText: string | null;
  /** 입력 방식: staff = 농원 사람이 입력, customer = 고객이 주문서로 직접 작성 */
  @Column({ type: 'varchar', default: 'staff' }) inputBy: 'staff' | 'customer';
  @Column({ type: 'timestamptz' }) orderedAt: Date;
  @Column({ type: 'int', nullable: true }) createdBy: number | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
  @OneToMany(() => Shipment, (s) => s.order, { cascade: true }) shipments: Shipment[];
}

export type ShipmentStatus = 'pending' | 'packed' | 'shipped';

@Entity('shipments')
export class Shipment {
  @PrimaryGeneratedColumn() id: number;
  @Column() orderId: number;
  @ManyToOne(() => Order, (o) => o.shipments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order: Order;
  @Column() recipientName: string;
  @Column({ type: 'varchar', length: 11, default: '' }) recipientPhone: string;
  @Column() address: string;
  @Column({ default: true }) addressConfirmed: boolean;
  @Column({ type: 'date', nullable: true }) shipDate: string | null;
  @Column({ type: 'varchar', default: 'pending' }) status: ShipmentStatus;
  @Column({ type: 'timestamptz', nullable: true }) packedAt: Date | null;
  @Column({ type: 'int', nullable: true }) packedBy: number | null;
  @Column({ type: 'timestamptz', nullable: true }) shippedAt: Date | null;
  @Column({ type: 'date', nullable: true }) receivedDate: string | null;
  @Column({ default: false }) isReship: boolean;
  @Column({ type: 'varchar', nullable: true }) memo: string | null;
  @OneToMany(() => ShipmentItem, (i) => i.shipment, { cascade: true, eager: true }) items: ShipmentItem[];
}

@Entity('shipment_items')
export class ShipmentItem {
  @PrimaryGeneratedColumn() id: number;
  @Column() shipmentId: number;
  @ManyToOne(() => Shipment, (s) => s.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'shipmentId' })
  shipment: Shipment;
  @Column() productId: number;
  @ManyToOne(() => Product, { eager: true })
  @JoinColumn({ name: 'productId' })
  product: Product;
  @Column('int') qtyBoxes: number;
  @Column('int') unitPrice: number;
}

export type IncidentStatus = 'received' | 'in_progress' | 'done';

@Entity('incidents')
export class Incident {
  @PrimaryGeneratedColumn() id: number;
  @Column() shipmentId: number;
  @ManyToOne(() => Shipment)
  @JoinColumn({ name: 'shipmentId' })
  shipment: Shipment;
  @Column({ type: 'varchar' }) type: 'broken' | 'spoiled' | 'other';
  @Column({ type: 'date' }) receivedDate: string;
  @Column({ type: 'timestamptz' }) reportedAt: Date;
  @Column({ default: false }) isLate: boolean;
  @Column({ type: 'int', nullable: true }) lateApprovedBy: number | null;
  @Column({ type: 'timestamptz', nullable: true }) lateApprovedAt: Date | null;
  @Column({ type: 'varchar', default: 'received' }) status: IncidentStatus;
  @Column({ type: 'int', nullable: true }) reshipShipmentId: number | null;
  @Column({ type: 'text', default: '' }) memo: string;
  @OneToMany(() => IncidentPhoto, (p) => p.incident) photos: IncidentPhoto[];
  @OneToMany(() => IncidentLog, (l) => l.incident) logs: IncidentLog[];
}

@Entity('incident_photos')
export class IncidentPhoto {
  @PrimaryGeneratedColumn() id: number;
  @Column() incidentId: number;
  @ManyToOne(() => Incident, (i) => i.photos, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'incidentId' })
  incident: Incident;
  @Column() mimeType: string;
  @Column({ type: 'bytea', select: false }) data: Buffer;
  @CreateDateColumn({ type: 'timestamptz' }) uploadedAt: Date;
}

@Entity('incident_logs')
export class IncidentLog {
  @PrimaryGeneratedColumn() id: number;
  @Column() incidentId: number;
  @ManyToOne(() => Incident, (i) => i.logs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'incidentId' })
  incident: Incident;
  @Column({ type: 'int', nullable: true }) userId: number | null;
  @Column() action: string;
  @Column({ type: 'text', default: '' }) memo: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('knowledge_docs')
export class KnowledgeDoc {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'varchar' }) source: 'farm_note' | 'center';
  @Column() title: string;
  @Column({ type: 'varchar', nullable: true }) variety: string | null;
  @OneToMany(() => KnowledgeChunk, (c) => c.doc) chunks: KnowledgeChunk[];
}

@Entity('knowledge_chunks')
export class KnowledgeChunk {
  @PrimaryGeneratedColumn() id: number;
  @Column() docId: number;
  @ManyToOne(() => KnowledgeDoc, (d) => d.chunks, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'docId' })
  doc: KnowledgeDoc;
  @Column('int', { nullable: true }) page: number | null;
  @Column('text') content: string;
  @Column('float8', { array: true, nullable: true, select: false }) embedding: number[] | null;
}

@Entity('qa_logs')
export class QaLog {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'int', nullable: true }) userId: number | null;
  @Column('text') question: string;
  @Column('text') answer: string;
  @Column() found: boolean;
  @Column('int', { array: true, default: '{}' }) sourceChunkIds: number[];
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('settings')
export class Setting {
  @PrimaryGeneratedColumn() id: number;
  @Column({ unique: true }) key: string;
  @Column('text') value: string;
}

export const ENTITIES = [
  User,
  Customer,
  Variety,
  Product,
  Order,
  Shipment,
  ShipmentItem,
  Incident,
  IncidentPhoto,
  IncidentLog,
  KnowledgeDoc,
  KnowledgeChunk,
  QaLog,
  Setting,
];

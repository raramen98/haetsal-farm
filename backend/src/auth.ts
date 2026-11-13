import {
  Body,
  CanActivate,
  Controller,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Post,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { Role, User } from './entities';

export interface AuthUser {
  id: number;
  name: string;
  role: Role;
}

export const ROLES_KEY = 'roles';
export const PUBLIC_KEY = 'public';
/** 이 API를 부를 수 있는 역할 (기능명세서 4.2) */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
export const Public = () => SetMetadata(PUBLIC_KEY, true);
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

/** 전역 가드: JWT 확인 + 역할 확인. @Roles 없는 API는 admin 전용으로 취급(안전한 기본값) */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('로그인이 필요합니다');
    try {
      req.user = this.jwt.verify(token) as AuthUser;
    } catch {
      throw new UnauthorizedException('로그인이 만료되었습니다');
    }
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, targets) || ['admin'];
    if (!roles.includes(req.user.role)) throw new ForbiddenException('이 기능을 사용할 권한이 없습니다');
    return true;
  }
}

@Controller('auth')
export class AuthController {
  constructor(@InjectRepository(User) private users: Repository<User>, private jwt: JwtService) {}

  @Public()
  @Post('login')
  async login(@Body() body: { loginId: string; password: string }) {
    const u = await this.users.findOne({ where: { loginId: body?.loginId || '' } });
    if (!u || !(await bcrypt.compare(body.password || '', u.passwordHash)))
      throw new UnauthorizedException('아이디 또는 비밀번호가 맞지 않습니다');
    const payload: AuthUser = { id: u.id, name: u.name, role: u.role };
    return { token: this.jwt.sign(payload), user: payload };
  }
}

import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Injectable()
export class AuthService {
  private readonly forgotPasswordMessage =
    'Se o e-mail estiver cadastrado, você receberá instruções para redefinir a senha.';

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private config: ConfigService,
    private prisma: PrismaService,
  ) {}

  async register(dto: RegisterDto) {
    const user = await this.usersService.create(dto);
    return this.generateTokens(user.id, user.email, user.role);
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) throw new UnauthorizedException('Credenciais inválidas');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Credenciais inválidas');

    return this.generateTokens(user.id, user.email, user.role);
  }

  async refresh(token: string) {
    const stored = await this.prisma.refreshToken.findUnique({ where: { token } });
    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token inválido ou expirado');
    }

    await this.prisma.refreshToken.delete({ where: { token } });

    const user = await this.usersService.findById(stored.userId);
    return this.generateTokens(user.id, user.email, user.role);
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      return { message: this.forgotPasswordMessage };
    }

    const resetToken = this.jwtService.sign(
      { sub: user.id, email: user.email, purpose: 'password-reset' },
      {
        secret: this.config.get<string>('JWT_RESET_SECRET') ?? this.config.getOrThrow<string>('JWT_SECRET'),
        expiresIn: (this.config.get('JWT_RESET_EXPIRES_IN') ?? '15m') as `${number}${'s'|'m'|'h'|'d'}`,
      },
    );

    console.log(`[Auth] Password reset token for ${user.email}: ${resetToken}`);

    return { message: this.forgotPasswordMessage };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const resetSecret =
      this.config.get<string>('JWT_RESET_SECRET') ??
      this.config.getOrThrow<string>('JWT_SECRET');

    let payload: { sub: string; purpose?: string };
    try {
      payload = this.jwtService.verify(dto.token, { secret: resetSecret });
    } catch {
      throw new BadRequestException('Token inválido ou expirado');
    }

    if (payload.purpose !== 'password-reset') {
      throw new BadRequestException('Token inválido ou expirado');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { id: payload.sub },
      data: { passwordHash },
    });

    // Invalida todos os refresh tokens do usuário forçando novo login
    await this.prisma.refreshToken.deleteMany({ where: { userId: payload.sub } });

    return { message: 'Senha redefinida com sucesso.' };
  }

  private async generateTokens(userId: string, email: string, role: string) {
    const payload = { sub: userId, email, role };

    const accessToken = this.jwtService.sign(payload);

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: (this.config.get('JWT_REFRESH_EXPIRES_IN') ?? '7d') as `${number}${'s'|'m'|'h'|'d'}`,
    });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.prisma.refreshToken.create({
      data: { token: refreshToken, userId, expiresAt },
    });

    return { accessToken, refreshToken };
  }
}

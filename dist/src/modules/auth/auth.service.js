"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const config_1 = require("@nestjs/config");
const bcrypt = __importStar(require("bcrypt"));
const users_service_1 = require("../users/users.service");
const prisma_service_1 = require("../../prisma/prisma.service");
let AuthService = class AuthService {
    usersService;
    jwtService;
    config;
    prisma;
    forgotPasswordMessage = 'Se o e-mail estiver cadastrado, você receberá instruções para redefinir a senha.';
    constructor(usersService, jwtService, config, prisma) {
        this.usersService = usersService;
        this.jwtService = jwtService;
        this.config = config;
        this.prisma = prisma;
    }
    async register(dto) {
        const user = await this.usersService.create(dto);
        return this.generateTokens(user.id, user.email, user.role);
    }
    async login(dto) {
        const user = await this.usersService.findByEmail(dto.email);
        if (!user)
            throw new common_1.UnauthorizedException('Credenciais inválidas');
        const valid = await bcrypt.compare(dto.password, user.passwordHash);
        if (!valid)
            throw new common_1.UnauthorizedException('Credenciais inválidas');
        return this.generateTokens(user.id, user.email, user.role);
    }
    async refresh(token) {
        const stored = await this.prisma.refreshToken.findUnique({ where: { token } });
        if (!stored || stored.expiresAt < new Date()) {
            throw new common_1.UnauthorizedException('Refresh token inválido ou expirado');
        }
        await this.prisma.refreshToken.delete({ where: { token } });
        const user = await this.usersService.findById(stored.userId);
        return this.generateTokens(user.id, user.email, user.role);
    }
    async logout(refreshToken) {
        await this.prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
    }
    async forgotPassword(dto) {
        const user = await this.usersService.findByEmail(dto.email);
        if (!user) {
            return { message: this.forgotPasswordMessage };
        }
        const resetToken = this.jwtService.sign({ sub: user.id, email: user.email, purpose: 'password-reset' }, {
            secret: this.config.get('JWT_RESET_SECRET') ?? this.config.getOrThrow('JWT_SECRET'),
            expiresIn: (this.config.get('JWT_RESET_EXPIRES_IN') ?? '15m'),
        });
        console.log(`[Auth] Password reset token for ${user.email}: ${resetToken}`);
        return { message: this.forgotPasswordMessage };
    }
    async resetPassword(dto) {
        const resetSecret = this.config.get('JWT_RESET_SECRET') ??
            this.config.getOrThrow('JWT_SECRET');
        let payload;
        try {
            payload = this.jwtService.verify(dto.token, { secret: resetSecret });
        }
        catch {
            throw new common_1.BadRequestException('Token inválido ou expirado');
        }
        if (payload.purpose !== 'password-reset') {
            throw new common_1.BadRequestException('Token inválido ou expirado');
        }
        const passwordHash = await bcrypt.hash(dto.newPassword, 10);
        await this.prisma.user.update({
            where: { id: payload.sub },
            data: { passwordHash },
        });
        await this.prisma.refreshToken.deleteMany({ where: { userId: payload.sub } });
        return { message: 'Senha redefinida com sucesso.' };
    }
    async generateTokens(userId, email, role) {
        const payload = { sub: userId, email, role };
        const accessToken = this.jwtService.sign(payload);
        const refreshToken = this.jwtService.sign(payload, {
            secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
            expiresIn: (this.config.get('JWT_REFRESH_EXPIRES_IN') ?? '7d'),
        });
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);
        await this.prisma.refreshToken.create({
            data: { token: refreshToken, userId, expiresAt },
        });
        return { accessToken, refreshToken };
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [users_service_1.UsersService,
        jwt_1.JwtService,
        config_1.ConfigService,
        prisma_service_1.PrismaService])
], AuthService);
//# sourceMappingURL=auth.service.js.map
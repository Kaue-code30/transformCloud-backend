import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { BillingModule } from './modules/billing/billing.module';
import { MigrationsModule } from './modules/migrations/migrations.module';
import { ObservabilityModule } from './modules/observability/observability.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    BillingModule,
    MigrationsModule,
    ObservabilityModule,
    IntegrationsModule,
  ],
})
export class AppModule {}

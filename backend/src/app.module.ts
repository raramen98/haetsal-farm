import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiController, AiService, QaService } from './ai';
import { AuthController, AuthGuard, Public } from './auth';
import { CustomersController } from './customers';
import { ENTITIES } from './entities';
import { ImportsController } from './imports';
import { IncidentsController } from './incidents';
import { OrdersController, OrdersService } from './orders';
import { SettingsController, SettingsService } from './settings.service';
import { ShippingController } from './shipping';
import { StockController, StockService } from './stock';
import { dbOptions } from './db';
import { PublicController } from './public';

@Controller()
class HealthController {
  @Public() @Get('health') health() {
    return { ok: true, time: new Date().toISOString() };
  }
}

@Module({
  imports: [
    TypeOrmModule.forRoot(dbOptions()),
    TypeOrmModule.forFeature(ENTITIES),
    JwtModule.register({ secret: process.env.JWT_SECRET || 'dev-only-secret', signOptions: { expiresIn: '12h' } }),
  ],
  controllers: [
    HealthController, AuthController, SettingsController, StockController, OrdersController, CustomersController,
    ShippingController, IncidentsController, ImportsController, AiController, PublicController,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }, SettingsService, StockService, OrdersService, AiService, QaService],
})
export class AppModule {}

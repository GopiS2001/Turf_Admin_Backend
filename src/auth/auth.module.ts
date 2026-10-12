import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { AuthConfig } from './auth.config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthSession } from './auth-session.entity';
import { JwtStrategy } from './jwt.strategy';
import { SessionsService } from './sessions.service';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    TypeOrmModule.forFeature([AuthSession]),
    // Secrets and lifetimes are passed per call (access vs refresh) from AuthConfig.
    JwtModule.register({
      signOptions: { algorithm: 'HS256' },
      verifyOptions: { algorithms: ['HS256'] },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthConfig, AuthService, SessionsService, JwtStrategy],
})
export class AuthModule {}

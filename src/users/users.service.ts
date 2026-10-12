import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Brackets, Repository } from 'typeorm';
import {
  USER_SESSIONS_REVOKE,
  type UserSessionsRevokeEvent,
} from '../auth/events';
import { paginate } from '../common/dto/pagination.dto';
import { AccountStatus, Role } from '../common/enums';
import {
  CreateUserDto,
  ListUsersQueryDto,
  UpdateUserDto,
} from './dto/user.dto';
import { User } from './user.entity';

export const BCRYPT_ROUNDS = 12;
export const UPLOAD_ROOT = join(process.cwd(), 'uploads');

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly events: EventEmitter2,
  ) {}

  async list(query: ListUsersQueryDto) {
    const qb = this.users
      .createQueryBuilder('u')
      .orderBy('u.createdAt', 'DESC');
    if (query.role) qb.andWhere('u.role = :role', { role: query.role });
    if (query.status)
      qb.andWhere('u.status = :status', { status: query.status });
    if (query.q) {
      const q = `%${query.q}%`;
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('u.name LIKE :q', { q })
            .orWhere('u.email LIKE :q', { q })
            .orWhere('u.phone LIKE :q', { q }),
        ),
      );
    }
    const [data, total] = await qb
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return paginate(data, total, query.page, query.limit);
  }

  async findOne(id: number) {
    const user = await this.users.findOneBy({ id });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** Includes the password hash — for authentication only. */
  findByEmailWithPassword(email: string) {
    return this.users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.email = :email', { email: email.trim().toLowerCase() })
      .getOne();
  }

  findByIdWithPassword(id: number) {
    return this.users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.id = :id', { id })
      .getOne();
  }

  async create(dto: CreateUserDto) {
    await this.assertEmailFree(dto.email);
    const { password, confirmPassword, ...rest } = dto;
    const role = dto.role ?? Role.CUSTOMER;
    if (role === Role.ADMIN && !password) {
      throw new BadRequestException('Admins need a password to sign in');
    }
    const user = this.users.create({
      ...rest,
      role,
      status: dto.status ?? AccountStatus.ACTIVE,
      // Only admins sign in; customers are records without a password.
      passwordHash:
        role === Role.ADMIN && password
          ? await bcrypt.hash(password, BCRYPT_ROUNDS)
          : null,
    });
    const saved = await this.users.save(user);
    return this.findOne(saved.id);
  }

  /** `actorSessionId` keeps the editing admin signed in when they change their own password. */
  async update(
    id: number,
    dto: UpdateUserDto,
    actorId?: number,
    actorSessionId?: string,
  ) {
    const user = await this.findOne(id);
    if (dto.email && dto.email !== user.email)
      await this.assertEmailFree(dto.email);
    if (actorId === id && dto.status === AccountStatus.INACTIVE) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    if (actorId === id && dto.role && dto.role !== user.role) {
      throw new BadRequestException('You cannot change your own role');
    }

    const { password, confirmPassword, ...rest } = dto;
    const role = dto.role ?? user.role;
    if (role === Role.ADMIN) {
      const current = await this.findByIdWithPassword(id);
      if (!password && !current?.passwordHash) {
        throw new BadRequestException(
          'Set a password so this admin can sign in',
        );
      }
    }

    const deactivated =
      user.status === AccountStatus.ACTIVE &&
      dto.status === AccountStatus.INACTIVE;
    const demoted = user.role === Role.ADMIN && role !== Role.ADMIN;

    Object.assign(user, rest);
    await this.users.save(user);
    if (role === Role.CUSTOMER) {
      // Demoted to customer: remove the ability to sign in.
      await this.users.update(id, { passwordHash: null });
    } else if (password) {
      await this.users.update(id, {
        passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      });
    }

    // Sign the account out of every device when its access changes.
    const reason = deactivated
      ? 'ACCOUNT_DISABLED'
      : demoted
        ? 'ROLE_CHANGED'
        : password
          ? 'PASSWORD_RESET'
          : null;
    if (reason) {
      const event: UserSessionsRevokeEvent = {
        userId: id,
        reason,
        exceptSessionId: actorId === id ? actorSessionId : undefined,
      };
      await this.events.emitAsync(USER_SESSIONS_REVOKE, event);
    }
    return this.findOne(id);
  }

  async setPassword(id: number, password: string) {
    await this.users.update(id, {
      passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
    });
  }

  async remove(id: number, actorId?: number) {
    if (actorId === id)
      throw new BadRequestException('You cannot delete your own account');
    const user = await this.findOne(id);
    await this.users.remove(user);
    await this.deleteFile(user.profileImage);
    return { deleted: true };
  }

  async setAvatar(id: number, filename: string) {
    const user = await this.findOne(id);
    const previous = user.profileImage;
    user.profileImage = `/uploads/avatars/${filename}`;
    await this.users.save(user);
    await this.deleteFile(previous);
    return user;
  }

  private async assertEmailFree(email: string) {
    if (await this.users.existsBy({ email })) {
      throw new ConflictException('An account with this email already exists');
    }
  }

  private async deleteFile(publicPath: string | null) {
    if (!publicPath?.startsWith('/uploads/')) return;
    await unlink(join(UPLOAD_ROOT, publicPath.replace('/uploads/', ''))).catch(
      () => undefined,
    );
  }
}

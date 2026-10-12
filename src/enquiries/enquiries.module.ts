import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Roles } from '../common/decorators/auth.decorators';
import { paginate } from '../common/dto/pagination.dto';
import { Role } from '../common/enums';
import {
  CreateEnquiryDto,
  ListEnquiriesQueryDto,
  UpdateEnquiryDto,
} from './dto/enquiry.dto';
import { Enquiry } from './enquiry.entity';

@Injectable()
export class EnquiriesService {
  constructor(
    @InjectRepository(Enquiry) private readonly enquiries: Repository<Enquiry>,
  ) {}

  create(dto: CreateEnquiryDto) {
    return this.enquiries.save(
      this.enquiries.create({ ...dto, email: dto.email.toLowerCase() }),
    );
  }

  async list(query: ListEnquiriesQueryDto) {
    const qb = this.enquiries
      .createQueryBuilder('e')
      .orderBy('e.createdAt', 'DESC');
    if (query.status) qb.andWhere('e.status = :s', { s: query.status });
    if (query.q) {
      const q = `%${query.q}%`;
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('e.name LIKE :q', { q })
            .orWhere('e.email LIKE :q', { q })
            .orWhere('e.subject LIKE :q', { q }),
        ),
      );
    }
    const [data, total] = await qb
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return paginate(data, total, query.page, query.limit);
  }

  async update(id: number, dto: UpdateEnquiryDto) {
    const enquiry = await this.enquiries.findOneBy({ id });
    if (!enquiry) throw new NotFoundException('Enquiry not found');
    enquiry.status = dto.status;
    return this.enquiries.save(enquiry);
  }

  async remove(id: number) {
    const result = await this.enquiries.delete(id);
    if (!result.affected) throw new NotFoundException('Enquiry not found');
    return { deleted: true };
  }
}

@ApiTags('Enquiries')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('enquiries')
export class EnquiriesController {
  constructor(private readonly enquiries: EnquiriesService) {}

  @Get()
  list(@Query() query: ListEnquiriesQueryDto) {
    return this.enquiries.list(query);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateEnquiryDto) {
    return this.enquiries.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.enquiries.remove(id);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Enquiry])],
  controllers: [EnquiriesController],
  providers: [EnquiriesService],
  exports: [EnquiriesService],
})
export class EnquiriesModule {}

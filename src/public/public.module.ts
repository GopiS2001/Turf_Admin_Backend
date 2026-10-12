import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Post,
  Query,
} from '@nestjs/common';
import { ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Throttle } from '@nestjs/throttler';
import { Matches } from 'class-validator';
import { Repository } from 'typeorm';
import { BookingsModule } from '../bookings/bookings.module';
import { BookingsService } from '../bookings/bookings.service';
import { DATE_RULE } from '../bookings/dto/booking.dto';
import { Public } from '../common/decorators/auth.decorators';
import { DocumentsModule } from '../documents/documents.module';
import { DocumentsService } from '../documents/documents.service';
import { GalleryImage, Review, TurfService } from '../content/content.entities';
import { CreateEnquiryDto } from '../enquiries/dto/enquiry.dto';
import {
  EnquiriesModule,
  EnquiriesService,
} from '../enquiries/enquiries.module';
import { PricingModule } from '../pricing/pricing.module';
import { PricingService } from '../pricing/pricing.service';
import { PublicBookingDto } from './dto/public-booking.dto';

export class SlotsQueryDto {
  @ApiPropertyOptional({ example: '2026-10-10' })
  @Matches(DATE_RULE, { message: 'date must be YYYY-MM-DD' })
  date: string;
}

/**
 * Endpoints used by the customer website. Response shapes match the website's
 * `src/lib/types.ts` so it can switch from mock data with one env variable.
 */
@ApiTags('Public (website)')
@Public()
@Controller('public')
export class PublicController {
  constructor(
    @InjectRepository(TurfService)
    private readonly services: Repository<TurfService>,
    @InjectRepository(GalleryImage)
    private readonly gallery: Repository<GalleryImage>,
    @InjectRepository(Review) private readonly reviews: Repository<Review>,
    private readonly pricing: PricingService,
    private readonly bookings: BookingsService,
    private readonly enquiries: EnquiriesService,
    private readonly documents: DocumentsService,
  ) {}

  @Get('services')
  async listServices() {
    const rows = await this.services.find({
      where: { active: true },
      order: { sortOrder: 'ASC' },
    });
    return rows.map((s) => ({
      id: s.slug,
      title: s.title,
      description: s.description,
      icon: s.icon,
    }));
  }

  @Get('pricing')
  async listPricing() {
    const plans = await this.pricing.findAll();
    return plans.map((p) => ({
      id: p.code,
      name: p.name,
      timing: p.timing,
      pricePerHour: p.pricePerHour,
      maxGuests: p.maxGuests,
      pricePerGuest: p.pricePerGuest,
      features: p.features,
      popular: p.popular,
    }));
  }

  @Get('gallery')
  async listGallery() {
    const rows = await this.gallery.find({
      where: { active: true },
      order: { sortOrder: 'ASC' },
    });
    return rows.map((g) => ({
      id: String(g.id),
      src: g.src,
      alt: g.alt,
      category: g.category,
      width: g.width,
      height: g.height,
    }));
  }

  @Get('reviews')
  async listReviews() {
    const rows = await this.reviews.find({
      where: { published: true },
      order: { sortOrder: 'ASC' },
    });
    return rows.map((r) => ({
      id: String(r.id),
      name: r.name,
      role: r.role,
      rating: r.rating,
      comment: r.comment,
    }));
  }

  @Get('slots')
  slots(@Query() query: SlotsQueryDto) {
    return this.bookings.slots(query.date);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('bookings')
  async createBooking(@Body() dto: PublicBookingDto) {
    const { bookingId, ...confirmation } =
      await this.bookings.createFromWebsite({
        ...dto,
        email: dto.email || undefined,
      });
    // Link to the booking confirmation PDF for the "Download PDF" button.
    const { token } = await this.documents.load(bookingId);
    return {
      ...confirmation,
      pdfUrl: this.documents.shareUrl('booking', token),
    };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('enquiries')
  @HttpCode(201)
  async createEnquiry(@Body() dto: CreateEnquiryDto) {
    await this.enquiries.create(dto);
    return { ok: true };
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([TurfService, GalleryImage, Review]),
    PricingModule,
    BookingsModule,
    EnquiriesModule,
    DocumentsModule,
  ],
  controllers: [PublicController],
})
export class PublicModule {}

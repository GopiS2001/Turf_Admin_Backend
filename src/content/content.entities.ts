import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Website "Services" cards. */
@Entity('services')
export class TurfService {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 40, unique: true })
  slug: string;

  @Column({ length: 80 })
  title: string;

  @Column({ type: 'varchar', length: 400 })
  description: string;

  /** football | cricket | trophy | briefcase | cake | whistle */
  @Column({ length: 20 })
  icon: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ default: true })
  active: boolean;
}

@Entity('gallery_images')
export class GalleryImage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  src: string;

  @Column({ length: 160 })
  alt: string;

  /** Turf | Matches | Cricket | Events */
  @Column({ length: 20 })
  category: string;

  @Column({ type: 'int' })
  width: number;

  @Column({ type: 'int' })
  height: number;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ default: true })
  active: boolean;
}

@Entity('reviews')
export class Review {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  name: string;

  @Column({ length: 100 })
  role: string;

  @Column({ type: 'tinyint' })
  rating: number;

  @Column({ type: 'text' })
  comment: string;

  @Column({ default: true })
  published: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;
}

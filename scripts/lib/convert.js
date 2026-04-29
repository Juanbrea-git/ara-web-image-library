import sharp from 'sharp';

export async function toWebp(buffer, { quality = 82, effort = 4 } = {}) {
  return sharp(buffer, { failOn: 'none' })
    .webp({ quality, effort })
    .toBuffer();
}

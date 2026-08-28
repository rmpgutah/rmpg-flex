import { describe, test, expect } from 'vitest';
import { corpusObjectExt, isTesstrainRasterKey, pageNumberFromRasterKey, rasterExtFromKey } from '../src/utils/tesseractTrainingCorpus';

describe('tesseract training corpus helpers', () => {
  test('maps MIME types to R2 object extensions', () => {
    expect(corpusObjectExt('image/png')).toBe('.png');
    expect(corpusObjectExt('image/jpeg')).toBe('.jpg');
    expect(corpusObjectExt('application/pdf')).toBe('.pdf');
    expect(corpusObjectExt('application/octet-stream')).toBe('.bin');
  });

  test('only raster images are tesstrain-eligible', () => {
    expect(isTesstrainRasterKey('training-corpus/12/image.png')).toBe(true);
    expect(isTesstrainRasterKey('training-corpus/12/page-003.jpg')).toBe(true);
    expect(isTesstrainRasterKey('training-corpus/12/image.pdf')).toBe(false);
    expect(isTesstrainRasterKey('training-corpus/12/ground-truth.txt')).toBe(false);
  });

  test('parses page numbers and extensions from raster keys', () => {
    expect(pageNumberFromRasterKey('training-corpus/12/page-003.jpg')).toBe(3);
    expect(pageNumberFromRasterKey('training-corpus/12/image.png')).toBeNull();
    expect(rasterExtFromKey('training-corpus/12/page-001.jpeg')).toBe('jpg');
  });
});

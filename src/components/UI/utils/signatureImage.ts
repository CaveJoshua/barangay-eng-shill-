// ✍️ Shared signature-image processing — used by both the Officials modal
// (Punong Barangay registering someone else) and the Profile page (an official
// managing their own signature). One canonical implementation so the two forms
// can never silently drift apart in how they clean/validate a signature.

// Raw upload guard — checked BEFORE any processing so a bad file never touches
// the canvas. Kept well under the backend's 8MB Cloudinary guard.
const MAX_RAW_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export const validateSignatureFile = (file: File): string | null => {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return 'Please upload a PNG, JPG, or WEBP image of the signature.';
  }
  if (file.size > MAX_RAW_BYTES) {
    return 'Signature image is too large (max 5MB).';
  }
  return null;
};

// A signature is almost always dark ink on a lighter (paper/scan) background.
// Rather than a hard color-key cutout, this ramps alpha smoothly between two
// luminance thresholds — pixels darker than DARK_THRESHOLD stay fully opaque,
// pixels lighter than LIGHT_THRESHOLD become fully transparent, and the band
// between the two anti-aliases the stroke edges instead of leaving jagged cutouts.
const DARK_THRESHOLD = 120;
const LIGHT_THRESHOLD = 225;

// Signatures don't need to be huge — capping the working size keeps the
// resulting PNG small (faster upload, smaller document embeds) without any
// visible quality loss for a signature stamp.
const MAX_DIMENSION = 900;

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read the image file.'));
    img.src = src;
  });

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read the image file.'));
    reader.readAsDataURL(file);
  });

// Cleans a signature image's background to transparent and returns a PNG data
// URL. Throws with a user-facing message on failure — callers should catch and
// surface it (never silently drop a failed upload).
export const cleanSignatureBackground = async (file: File): Promise<string> => {
  const validationError = validateSignatureFile(file);
  if (validationError) throw new Error(validationError);

  const rawDataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(rawDataUrl);

  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot process images.');

  ctx.drawImage(img, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

    let alpha: number;
    if (luminance <= DARK_THRESHOLD) {
      alpha = 255;
    } else if (luminance >= LIGHT_THRESHOLD) {
      alpha = 0;
    } else {
      alpha = Math.round(255 * (LIGHT_THRESHOLD - luminance) / (LIGHT_THRESHOLD - DARK_THRESHOLD));
    }

    // Fold the image's own alpha in too (a source PNG can already be transparent).
    data[i + 3] = Math.round((alpha * data[i + 3]) / 255);
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
};

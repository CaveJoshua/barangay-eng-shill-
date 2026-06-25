import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';

// Siguraduhin na binabasa ang .env file mula sa root directory
dotenv.config();

// CONFIGURATION
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * UPLOAD FUNCTION: Handles Base64 strings from frontend
 */
export const uploadImage = async (fileString, folderName = 'barangay_announcements') => {
    try {
        // 1. Check kung empty ang image
        if (!fileString || fileString.trim() === "") {
            console.log("[CLOUDINARY] No image string provided, skipping upload.");
            return null;
        }

        // 2. Check kung existing URL na siya (para sa Edit mode)
        // Kung nagsisimula sa http, ibig sabihin naka-upload na, wag nang ulitin.
        if (fileString.startsWith('http')) {
            console.log("[CLOUDINARY] Existing URL detected, skipping re-upload.");
            return fileString;
        }

        // 3. ZERO TRUST VALIDATION: Siguraduhin na Base64 image talaga ito
        if (!fileString.startsWith('data:image')) {
            console.warn("[CLOUDINARY] Invalid image format detected. Rejecting upload.");
            return null;
        }

        // 4. Upload sa Cloudinary with custom naming
        console.log("[CLOUDINARY] New image detected. Uploading to folder:", folderName);
        
        const timestamp = Date.now();
        const uploadedResponse = await cloudinary.uploader.upload(fileString, {
            folder: folderName,
            resource_type: 'auto', 
            // Naming strategy: helps you find images in your Cloudinary Dashboard easily
            public_id: `img_${timestamp}`, 
            overwrite: true,
            invalidate: true // Clears Cloudflare/CDN cache if you update an image
        });

        console.log("[CLOUDINARY] Upload Success! URL:", uploadedResponse.secure_url);
        return uploadedResponse.secure_url;

    } catch (error) {
        console.error("**********************************************");
        console.error("CLOUDINARY UPLOAD CRITICAL ERROR:");
        console.error("Message:", error.message);
        if (error.http_code) console.error("HTTP Code:", error.http_code);
        console.error("**********************************************");
        
        // Return null instead of crashing the whole server
        return null; 
    }
};

export default cloudinary;
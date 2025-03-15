import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import multer from "multer";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import dotenv from "dotenv";
import { v2 as cloudinary } from "cloudinary";
import fs from "fs";
import path from "path";
import streamifier from "streamifier"; 

dotenv.config({ path: path.resolve(".env") });

console.log("Loaded Env Variables:", {
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET
});

const requiredEnvVars = [
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET"
];

let missingVars = requiredEnvVars.filter(key => !process.env[key]);

if (missingVars.length > 0) {
    console.warn(`⚠️ Warning: Missing environment variables: ${missingVars.join(", ")}`);
}

const serviceAccountPath = "./serviceAccountKey.json";
if (!fs.existsSync(serviceAccountPath)) {
    console.error("❌ Firebase service account file not found!");
    process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});
const db = getFirestore();

const app = express();
app.use(cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"]
}));

app.use(bodyParser.json());

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});
const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith("image/")) {
            return cb(new Error("Only images are allowed!"), false);
        }
        cb(null, true);
    },
});
const uploadToCloudinary = async (buffer) => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder: "issues" },
            (error, result) => {
                if (error) {
                    console.error("❌ Cloudinary Upload Error:", error.message);
                    reject(error);
                } else {
                    console.log("✅ Cloudinary Upload Success:", result.secure_url);
                    resolve(result.secure_url);
                }
            }
        );
        streamifier.createReadStream(buffer).pipe(stream); 
    });
};

app.post("/submit-issue", upload.single("issueImage"), async (req, res) => {
    try {
        console.log("Received request:", req.body);
        console.log("File received:", req.file ? req.file.originalname : "No file uploaded");

        const { issueType, issueTitle, issueDescription } = req.body;

        if (!issueType || !issueTitle || !issueDescription) {
            console.error("❌ Missing fields:", { issueType, issueTitle, issueDescription });
            return res.status(400).json({ message: "All fields are required." });
        }

        let imageUrl = null;

        if (req.file) {
            try {
                imageUrl = await uploadToCloudinary(req.file.buffer);
                console.log("✅ Image uploaded successfully:", imageUrl);
            } catch (uploadError) {
                console.error("❌ Cloudinary Upload Error:", uploadError.message);
                return res.status(500).json({ message: "Image upload failed", error: uploadError.message });
            }
        }

        const newIssueRef = await db.collection("issues").add({
            issueType,
            issueTitle,
            issueDescription,
            imageUrl: imageUrl || null,
            issueStatus: "Pending", 
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log("✅ Issue stored in Firestore:", newIssueRef.id);
        res.status(200).json({ message: "Issue submitted successfully!", id: newIssueRef.id });

    } catch (error) {
        console.error("❌ Error submitting issue:", error);
        res.status(500).json({ message: "Error submitting issue", error: error.message });
    }
});

const publicPath = path.join(process.cwd(), "public");
if (!fs.existsSync(publicPath)) {
    console.warn("⚠️ Warning: 'public' folder not found! Make sure your HTML files are inside it.");
}
app.use(express.static(publicPath));

const PORT = process.env.PORT || 5500;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});

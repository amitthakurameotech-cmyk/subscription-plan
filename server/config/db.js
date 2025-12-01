import mongoose from 'mongoose';

export const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.Db_Url, {

        });
        console.log("MongoDB Connected");
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1); // Exit process if DB connection fails
    }
};
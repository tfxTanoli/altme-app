'use server';

import nodemailer from 'nodemailer';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { Notification } from '@/services/notifications';

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.SMTP_EMAIL,
        pass: process.env.SMTP_PASSWORD,
    },
});

export const sendNotificationEmail = async (userId: string, notification: Omit<Notification, 'id' | 'timestamp' | 'isRead'>) => {
    if (!userId || !notification) return;

    try {
        // 1. Get user email
        let email = notification.recipientEmail;

        if (!email) {
            try {
                const userRecord = await adminAuth.getUser(userId);
                email = userRecord.email;
            } catch (authError) {
                console.warn(`Could not fetch user ${userId} from Auth, trying database/firestore or skipping email.`, authError);
            }
        }

        if (!email) {
            console.log(`No email found for user ${userId}, skipping email notification.`);
            return;
        }

        // 2. Prepare email content
        const mailOptions = {
            from: `"AltMe Notifications" <${process.env.SMTP_EMAIL}>`,
            to: email,
            subject: `New Notification: ${notification.title}`,
            text: `${notification.message}\n\nLink: ${notification.link}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #333;">${notification.title}</h2>
                    <p style="font-size: 16px; color: #555;">${notification.message}</p>
                    <div style="margin-top: 20px;">
                        <a href="${process.env.NEXT_PUBLIC_APP_URL || ''}${notification.link}" style="background-color: #0070f3; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
                            View Notification
                        </a>
                    </div>
                     <p style="margin-top: 30px; font-size: 12px; color: #888;">
                        This is an automated notification from AltMe.
                    </p>
                </div>
            `
        };

        // 3. Send email
        await transporter.sendMail(mailOptions);
        console.log(`Email notification sent to ${email}`);

    } catch (error) {
        console.error("Error sending email notification:", error);
    }
};

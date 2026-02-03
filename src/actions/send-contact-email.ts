'use server';

import nodemailer from 'nodemailer';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.SMTP_EMAIL,
        pass: process.env.SMTP_PASSWORD,
    },
});

export const sendContactEmail = async (data: { name: string; email: string; message: string; id: string }) => {
    let notificationSuccess = false;
    let emailSuccess = false;
    let emailError = null;

    // 1. Send Admin Notification (In-App)
    // We try this regardless of email configuration
    try {
        const adminsSnapshot = await adminDb.ref('users').orderByChild('role').equalTo('admin').once('value');
        const admins = adminsSnapshot.val();

        if (admins) {
            const adminIds = Object.keys(admins);
            const notificationPromises = adminIds.map(async (adminId) => {
                const notificationsRef = adminDb.ref(`notifications/${adminId}`);
                await notificationsRef.push({
                    type: 'new_contact_submission',
                    title: 'New Contact Us Message',
                    message: `From: ${data.name}. ${data.message.substring(0, 50)}${data.message.length > 50 ? '...' : ''}`,
                    link: '/admin/inbox',
                    relatedId: data.id,
                    timestamp: admin.database.ServerValue.TIMESTAMP,
                    isRead: false
                });
            });
            await Promise.all(notificationPromises);
            notificationSuccess = true;
        } else {
            // No admins found, strict failure of notification? 
            // We can treat it as 'logic ran successfully but no target'
            console.warn("No admins found to notify.");
            notificationSuccess = true;
        }
    } catch (error) {
        console.error("Error sending admin notifications:", error);
    }

    // 2. Check and Send Email
    if (!process.env.SMTP_EMAIL || !process.env.NEXT_PUBLIC_ADMIN_EMAIL) {
        console.warn("SMTP credentials or Admin Email not set. Skipping email.");
        emailError = "Configuration error (SMTP not set)";
    } else {
        try {
            const mailOptions = {
                from: `"AltMe Contact Form" <${process.env.SMTP_EMAIL}>`,
                to: process.env.NEXT_PUBLIC_ADMIN_EMAIL,
                replyTo: data.email,
                subject: `New Contact Form Submission from ${data.name}`,
                text: `Name: ${data.name}\nEmail: ${data.email}\nMessage:\n${data.message}`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #333;">New Contact Submission</h2>
                        <p><strong>Name:</strong> ${data.name}</p>
                        <p><strong>Email:</strong> ${data.email}</p>
                        <hr/>
                        <p style="font-size: 16px; color: #555; white-space: pre-wrap;">${data.message}</p>
                    </div>
                `
            };

            await transporter.sendMail(mailOptions);
            emailSuccess = true;

        } catch (error: any) {
            console.error("Error sending contact email:", error);
            emailError = error.message || "Failed to send email";
        }
    }

    // Determine overall success
    // If we managed to send a notification OR an email, we consider it a success from the user's perspective (message received).
    if (notificationSuccess || emailSuccess) {
        return { success: true };
    }

    // If both failed, return error
    return { success: false, error: emailError || "Failed to process submission" };
};

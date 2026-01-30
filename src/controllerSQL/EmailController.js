const express = require("express");
const nodemailer = require("nodemailer");

const app = express();
app.use(express.json());

module.exports = {
  EmailLogin: async (req, res) => {
    const { to, cc, bcc, subject, body } = req.body;

    if (!to) {
      return res.status(400).send({
        success: false,
        message: "Missing mandatory email fields: 'To' is required.",
      });
    }

    let transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL || "rohitanabhavane26@gmail.com",
        pass: process.env.EMAIL_PASSWORD || "eghq byjb ggbk wgbm",
      },
    });

    // Prepare the email data
    const mailOptions = {
      from: process.env.EMAIL || "rohitanabhavane26@gmail.com",
      to: to,
      cc: cc,
      bcc: bcc,
      subject: subject,
      html: body,
    };

    try {
      let info = await transporter.sendMail(mailOptions);
      res.status(200).send({
        success: true,
        message: "Email sent successfully",
        info: info,
      });
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Failed to send email",
        error: error.message,
      });
    }
  },
};

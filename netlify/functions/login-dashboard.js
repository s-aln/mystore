const crypto = require("crypto");

exports.handler = async function (event) {

    if (event.httpMethod !== "POST") {
        return {
            statusCode: 405,
            body: JSON.stringify({
                error: "Method not allowed"
            })
        };
    }

    try {

        const dashboardPassword = process.env.DASHBOARD_PASSWORD;
        const sessionSecret = process.env.DASHBOARD_SESSION_SECRET;

        if (!dashboardPassword || !sessionSecret) {
            return {
                statusCode: 500,
                body: JSON.stringify({
                    error: "Dashboard environment variables are missing."
                })
            };
        }

        const body = JSON.parse(event.body || "{}");
        const password = body.password || "";

        if (password !== dashboardPassword) {
            return {
                statusCode: 401,
                body: JSON.stringify({
                    error: "Incorrect password."
                })
            };
        }

        const timestamp = Date.now().toString();

        const data = `dashboard:${timestamp}`;

        const signature = crypto
            .createHmac("sha256", sessionSecret)
            .update(data)
            .digest("hex");

        const token = `${timestamp}.${signature}`;

        return {
            statusCode: 200,

            headers: {
                "Content-Type": "application/json",

                "Set-Cookie":
                    `slyde_dashboard=${token}; ` +
                    `HttpOnly; ` +
                    `Secure; ` +
                    `SameSite=Strict; ` +
                    `Path=/; ` +
                    `Max-Age=28800`
            },

            body: JSON.stringify({
                success: true
            })
        };

    } catch (error) {

        console.error("Dashboard login error:", error);

        return {
            statusCode: 500,
            body: JSON.stringify({
                error: "Server error."
            })
        };
    }
};
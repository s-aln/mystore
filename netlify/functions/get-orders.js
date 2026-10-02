const crypto = require("crypto");

exports.handler = async function (event) {

    if (event.httpMethod !== "GET") {
        return {
            statusCode: 405,
            body: JSON.stringify({
                error: "Method not allowed"
            })
        };
    }

    try {

        const sessionSecret =
            process.env.DASHBOARD_SESSION_SECRET;

        if (!sessionSecret) {
            return {
                statusCode: 500,
                body: JSON.stringify({
                    error: "Dashboard session secret is missing."
                })
            };
        }

        const cookies = event.headers.cookie || "";

        const sessionCookie = cookies
            .split(";")
            .map(cookie => cookie.trim())
            .find(cookie =>
                cookie.startsWith("slyde_dashboard=")
            );

        if (!sessionCookie) {
            return {
                statusCode: 401,
                body: JSON.stringify({
                    error: "Unauthorized."
                })
            };
        }

        const token = sessionCookie
            .substring("slyde_dashboard=".length);

        const parts = token.split(".");

        if (parts.length !== 2) {
            return {
                statusCode: 401,
                body: JSON.stringify({
                    error: "Unauthorized."
                })
            };
        }

        const timestamp = parts[0];
        const signature = parts[1];

        const timestampNumber = Number(timestamp);

        if (!Number.isFinite(timestampNumber)) {
            return {
                statusCode: 401,
                body: JSON.stringify({
                    error: "Unauthorized."
                })
            };
        }

        const eightHours = 8 * 60 * 60 * 1000;

        if (Date.now() - timestampNumber > eightHours) {
            return {
                statusCode: 401,
                body: JSON.stringify({
                    error: "Session expired."
                })
            };
        }

        const data = `dashboard:${timestamp}`;

        const expectedSignature = crypto
            .createHmac("sha256", sessionSecret)
            .update(data)
            .digest("hex");

if (
    signature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
    )
) {
            return {
                statusCode: 401,
                body: JSON.stringify({
                    error: "Unauthorized."
                })
            };
        }

        const supabaseUrl =
            process.env.SUPABASE_URL;

        const supabaseKey =
            process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !supabaseKey) {
            return {
                statusCode: 500,
                body: JSON.stringify({
                    error: "Supabase environment variables are missing."
                })
            };
        }

        const response = await fetch(
            `${supabaseUrl}/rest/v1/orders?payment_status=eq.paid&order=created_at.desc`,
            {
                method: "GET",

                headers: {
                    "apikey": supabaseKey,
                    "Authorization": `Bearer ${supabaseKey}`,
                    "Content-Type": "application/json"
                }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            console.error("Supabase error:", data);

            return {
                statusCode: 500,
                body: JSON.stringify({
                    error: "Could not load orders."
                })
            };
        }

        return {
            statusCode: 200,
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                success: true,
                orders: data
            })
        };

    } catch (error) {

        console.error("Get orders error:", error);

        return {
            statusCode: 500,
            body: JSON.stringify({
                error: "Server error while loading orders."
            })
        };
    }
};
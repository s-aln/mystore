const crypto = require("crypto");

exports.handler = async function (event) {

    if (event.httpMethod !== "POST") {
        return {
            statusCode: 405,
            body: JSON.stringify({
                error: "Method not allowed."
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

        const cookies =
            event.headers.cookie || "";

        const sessionCookie =
            cookies
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

        const token =
            sessionCookie.substring(
                "slyde_dashboard=".length
            );

        const parts =
            token.split(".");

        if (parts.length !== 2) {
            return {
                statusCode: 401,
                body: JSON.stringify({
                    error: "Unauthorized."
                })
            };
        }

        const timestamp =
            parts[0];

        const signature =
            parts[1];

        const timestampNumber =
            Number(timestamp);

        if (!Number.isFinite(timestampNumber)) {
            return {
                statusCode: 401,
                body: JSON.stringify({
                    error: "Unauthorized."
                })
            };
        }

        const eightHours =
            8 * 60 * 60 * 1000;

        if (
            Date.now() - timestampNumber >
            eightHours
        ) {
            return {
                statusCode: 401,
                body: JSON.stringify({
                    error: "Session expired."
                })
            };
        }

        const data =
            `dashboard:${timestamp}`;

        const expectedSignature =
            crypto
                .createHmac(
                    "sha256",
                    sessionSecret
                )
                .update(data)
                .digest("hex");

        if (
            signature.length !==
                expectedSignature.length ||
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
                    error:
                        "Supabase environment variables are missing."
                })
            };
        }

        const body =
            JSON.parse(event.body || "{}");

        const productId =
            Number(body.product_id);

        const stock =
            Number(body.stock);

        if (
            !Number.isInteger(productId) ||
            !Number.isInteger(stock) ||
            stock < 0
        ) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error:
                        "Product ID and stock must be valid."
                })
            };
        }

        const response =
            await fetch(
                `${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(productId)}`,
                {
                    method: "PATCH",

                    headers: {
                        "apikey": supabaseKey,
                        "Authorization":
                            `Bearer ${supabaseKey}`,
                        "Content-Type":
                            "application/json",
                        "Prefer":
                            "return=representation"
                    },

                    body: JSON.stringify({
                        stock: stock
                    })
                }
            );

        const result =
            await response.json();

        if (!response.ok) {

            console.error(
                "Supabase stock update error:",
                result
            );

            return {
                statusCode: 500,
                body: JSON.stringify({
                    error:
                        "Could not update stock."
                })
            };
        }

        if (result.length === 0) {
            return {
                statusCode: 404,
                body: JSON.stringify({
                    error:
                        "Product not found."
                })
            };
        }

        return {
            statusCode: 200,

            headers: {
                "Content-Type":
                    "application/json"
            },

            body: JSON.stringify({
                success: true,
                product: result[0]
            })
        };

    } catch (error) {

        console.error(
            "Update stock error:",
            error
        );

        return {
            statusCode: 500,
            body: JSON.stringify({
                error:
                    "Server error while updating stock."
            })
        };
    }
};
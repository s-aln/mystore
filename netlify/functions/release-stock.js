const crypto = require("crypto");

exports.handler = async function (event) {
    try {
        if (event.httpMethod !== "POST") {
            return {
                statusCode: 405,
                body: JSON.stringify({
                    success: false,
                    message: "Method not allowed."
                })
            };
        }

        const data = JSON.parse(event.body || "{}");
        const sessionId = data.session_id;

        if (!sessionId) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    success: false,
                    message: "Checkout session is missing."
                })
            };
        }

        const supabaseUrl =
            process.env.SUPABASE_URL;

        const supabaseKey =
            process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !supabaseKey) {
            console.error(
                "Supabase environment variables are missing."
            );

            return {
                statusCode: 500,
                body: JSON.stringify({
                    success: false,
                    message:
                        "Server configuration is incomplete."
                })
            };
        }

        const supabaseHeaders = {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json"
        };

        // --------------------------------------------------
        // 1. Make sure the checkout session exists
        // --------------------------------------------------

        const sessionResponse = await fetch(
            `${supabaseUrl}/rest/v1/checkout_sessions?id=eq.${encodeURIComponent(sessionId)}&select=id,status`,
            {
                method: "GET",
                headers: supabaseHeaders
            }
        );

        if (!sessionResponse.ok) {
            console.error(
                "Checkout session lookup failed:",
                await sessionResponse.text()
            );

            return {
                statusCode: 500,
                body: JSON.stringify({
                    success: false,
                    message:
                        "Could not check checkout session."
                })
            };
        }

        const sessions =
            await sessionResponse.json();

        if (!sessions.length) {
            return {
                statusCode: 404,
                body: JSON.stringify({
                    success: false,
                    message:
                        "Checkout session not found."
                })
            };
        }

        // --------------------------------------------------
        // 2. Do not release stock from a completed checkout
        // --------------------------------------------------

        if (sessions[0].status === "completed") {
            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: true,
                    released: false,
                    message:
                        "This checkout has already been completed."
                })
            };
        }

        // --------------------------------------------------
        // 3. Release the stock reservation
        // --------------------------------------------------

        const releaseResponse = await fetch(
            `${supabaseUrl}/rest/v1/rpc/release_stock_reservation`,
            {
                method: "POST",
                headers: supabaseHeaders,
                body: JSON.stringify({
                    p_checkout_session_id:
                        sessionId
                })
            }
        );

        const releaseResult =
            await releaseResponse.json();

        if (
            !releaseResponse.ok ||
            releaseResult !== true
        ) {
            console.error(
                "Stock reservation release failed:",
                releaseResult
            );

            return {
                statusCode: 500,
                body: JSON.stringify({
                    success: false,
                    message:
                        "Could not release reserved stock."
                })
            };
        }

        // --------------------------------------------------
        // 4. Mark checkout session as cancelled
        // --------------------------------------------------

        const updateResponse = await fetch(
            `${supabaseUrl}/rest/v1/checkout_sessions?id=eq.${encodeURIComponent(sessionId)}`,
            {
                method: "PATCH",
                headers: supabaseHeaders,
                body: JSON.stringify({
                    status: "cancelled"
                })
            }
        );

        if (!updateResponse.ok) {
            console.error(
                "Could not update checkout session:",
                await updateResponse.text()
            );

            return {
                statusCode: 500,
                body: JSON.stringify({
                    success: false,
                    message:
                        "Stock was released, but checkout status could not be updated."
                })
            };
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                released: true
            })
        };

    } catch (error) {
        console.error(
            "Release stock error:",
            error
        );

        return {
            statusCode: 500,
            body: JSON.stringify({
                success: false,
                message:
                    "Something went wrong while releasing stock."
            })
        };
    }
};
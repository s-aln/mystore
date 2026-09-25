
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

        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const ziinaApiKey = process.env.ZIINA_API_KEY;

        if (!supabaseUrl || !supabaseKey || !ziinaApiKey) {
            return {
                statusCode: 500,
                body: JSON.stringify({
                    success: false,
                    message: "Server configuration is incomplete."
                })
            };
        }

        // --------------------------------------------------
        // 1. Find our temporary checkout session
        // --------------------------------------------------

        const sessionResponse = await fetch(
            `${supabaseUrl}/rest/v1/checkout_sessions?id=eq.${encodeURIComponent(sessionId)}&select=*`,
            {
                method: "GET",
                headers: {
                    "apikey": supabaseKey,
                    "Authorization": `Bearer ${supabaseKey}`
                }
            }
        );

        if (!sessionResponse.ok) {
            console.error(
                "Supabase session lookup failed:",
                await sessionResponse.text()
            );

            return {
                statusCode: 500,
                body: JSON.stringify({
                    success: false,
                    message: "Could not find checkout session."
                })
            };
        }

        const sessions = await sessionResponse.json();

        if (!sessions.length) {
            return {
                statusCode: 404,
                body: JSON.stringify({
                    success: false,
                    message: "Checkout session not found."
                })
            };
        }

        const session = sessions[0];

        if (!session.payment_intent_id) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    success: false,
                    message: "Payment has not been created yet."
                })
            };
        }

        // --------------------------------------------------
        // 2. Ask Ziina for the REAL payment status
        // --------------------------------------------------

        const ziinaResponse = await fetch(
            `https://api-v2.ziina.com/api/payment_intent/${encodeURIComponent(session.payment_intent_id)}`,
            {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${ziinaApiKey}`,
                    "Content-Type": "application/json"
                }
            }
        );

        const payment = await ziinaResponse.json();

        if (!ziinaResponse.ok) {
            console.error("Ziina verification error:", payment);

            return {
                statusCode: 502,
                body: JSON.stringify({
                    success: false,
                    message: "Could not verify payment with Ziina."
                })
            };
        }

        console.log(
            "Ziina payment status:",
            payment.status
        );

        // --------------------------------------------------
        // 3. Payment is NOT completed
        // --------------------------------------------------

        if (payment.status !== "completed") {
            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: false,
                    paid: false,
                    status: payment.status
                })
            };
        }

        // --------------------------------------------------
        // 4. Payment IS completed
        //
        // For now we only return the verified information.
        // The next step will create the permanent order.
        // --------------------------------------------------

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                paid: true,
                status: "completed",
                session: {
                    id: session.id,
                    customer_name: session.customer_name,
                    phone: session.phone,
                    email: session.email,
                    address: session.address,
                    city: session.city,
                    notes: session.notes,
                    items: session.items,
                    subtotal: session.subtotal,
                    delivery_fee: session.delivery_fee,
                    total: session.total
                },
                payment_intent_id: session.payment_intent_id
            })
        };

    } catch (error) {
        console.error("Verify payment error:", error);

        return {
            statusCode: 500,
            body: JSON.stringify({
                success: false,
                message: "Something went wrong while verifying payment."
            })
        };
    }
};

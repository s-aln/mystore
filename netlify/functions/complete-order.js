
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
        // 1. Find checkout session
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
        // 2. Verify payment directly with Ziina
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

        // --------------------------------------------------
        // 3. Payment must be COMPLETED
        // --------------------------------------------------

        if (payment.status !== "completed") {
            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: false,
                    paid: false,
                    status: payment.status,
                    message: "Payment is not completed."
                })
            };
        }

        // --------------------------------------------------
        // 4. Verify the payment amount
        // --------------------------------------------------

        const expectedAmount = Math.round(
            Number(session.total) * 100
        );

        const paidAmount = Number(payment.amount);

        if (paidAmount !== expectedAmount) {
            console.error(
                "Payment amount mismatch:",
                {
                    expectedAmount,
                    paidAmount
                }
            );

            return {
                statusCode: 400,
                body: JSON.stringify({
                    success: false,
                    message: "Payment amount could not be verified."
                })
            };
        }

        // --------------------------------------------------
        // 5. Check whether this payment already created
        //    an order
        // --------------------------------------------------

        const existingOrderResponse = await fetch(
            `${supabaseUrl}/rest/v1/orders?ziina_payment_id=eq.${encodeURIComponent(session.payment_intent_id)}&select=id`,
            {
                method: "GET",
                headers: {
                    "apikey": supabaseKey,
                    "Authorization": `Bearer ${supabaseKey}`
                }
            }
        );

        if (!existingOrderResponse.ok) {
            console.error(
                "Could not check existing orders:",
                await existingOrderResponse.text()
            );

            return {
                statusCode: 500,
                body: JSON.stringify({
                    success: false,
                    message: "Could not check order status."
                })
            };
        }

        const existingOrders = await existingOrderResponse.json();

        // If the order already exists, return success instead
        // of creating a duplicate.
        if (existingOrders.length > 0) {
            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: true,
                    paid: true,
                    already_created: true,
                    order_id: existingOrders[0].id,
                    payment_intent_id: session.payment_intent_id,
                    total: session.total
                })
            };
        }

        // --------------------------------------------------
        // 6. Create the permanent order
        // --------------------------------------------------

        const orderResponse = await fetch(
            `${supabaseUrl}/rest/v1/orders`,
            {
                method: "POST",
                headers: {
                    "apikey": supabaseKey,
                    "Authorization": `Bearer ${supabaseKey}`,
                    "Content-Type": "application/json",
                    "Prefer": "return=representation"
                },
                body: JSON.stringify({
    customer_name: session.customer_name,
    phone: session.phone,
    email: session.email,
    address: session.address,
    city: session.city,
    notes: session.notes,
    items: session.items,
    subtotal: session.subtotal,
    delivery_fee: session.delivery_fee,
    total: session.total,
    payment_status: "paid",
    ziina_payment_id: session.payment_intent_id,
    created_at: new Date().toISOString()
})
            }
        );

        const orderResult = await orderResponse.json();

        if (!orderResponse.ok) {
            console.error(
                "Supabase order creation failed:",
                orderResult
            );

            return {
                statusCode: 500,
                body: JSON.stringify({
                    success: false,
                    message: "Payment was verified, but the order could not be saved."
                })
            };
        }

        const order = orderResult[0];

        // --------------------------------------------------
        // 7. Mark checkout session as completed
        // --------------------------------------------------

        await fetch(
            `${supabaseUrl}/rest/v1/checkout_sessions?id=eq.${encodeURIComponent(sessionId)}`,
            {
                method: "PATCH",
                headers: {
                    "apikey": supabaseKey,
                    "Authorization": `Bearer ${supabaseKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    status: "completed"
                })
            }
        );

        // --------------------------------------------------
        // 8. Return receipt information
        // --------------------------------------------------

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                paid: true,
                already_created: false,
                order_id: order.id,
                payment_intent_id: session.payment_intent_id,
                customer_name: session.customer_name,
                items: session.items,
                subtotal: session.subtotal,
                delivery_fee: session.delivery_fee,
                total: session.total,
                created_at: order.created_at
            })
        };

    } catch (error) {
        console.error("Complete order error:", error);

        return {
            statusCode: 500,
            body: JSON.stringify({
                success: false,
                message: "Something went wrong while completing the order."
            })
        };
    }
};
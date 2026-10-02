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
                    message:
                        "Checkout session is missing."
                })
            };
        }

        const supabaseUrl =
            process.env.SUPABASE_URL;

        const supabaseKey =
            process.env.SUPABASE_SERVICE_ROLE_KEY;

        const ziinaApiKey =
            process.env.ZIINA_API_KEY;

        if (
            !supabaseUrl ||
            !supabaseKey ||
            !ziinaApiKey
        ) {
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
            "Authorization":
                `Bearer ${supabaseKey}`,
            "Content-Type":
                "application/json"
        };

        // --------------------------------------------------
        // 1. Find checkout session
        // --------------------------------------------------

        const sessionResponse =
            await fetch(
                `${supabaseUrl}/rest/v1/checkout_sessions?id=eq.${encodeURIComponent(sessionId)}&select=*`,
                {
                    method: "GET",
                    headers: supabaseHeaders
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
                    message:
                        "Could not find checkout session."
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

        const session =
            sessions[0];

        if (!session.payment_intent_id) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    success: false,
                    message:
                        "Payment has not been created yet."
                })
            };
        }

        // --------------------------------------------------
        // 2. Verify payment directly with Ziina
        // --------------------------------------------------

        const ziinaResponse =
            await fetch(
                `https://api-v2.ziina.com/api/payment_intent/${encodeURIComponent(session.payment_intent_id)}`,
                {
                    method: "GET",
                    headers: {
                        "Authorization":
                            `Bearer ${ziinaApiKey}`,
                        "Content-Type":
                            "application/json"
                    }
                }
            );

        const payment =
            await ziinaResponse.json();

        if (!ziinaResponse.ok) {
            console.error(
                "Ziina verification error:",
                payment
            );

            return {
                statusCode: 502,
                body: JSON.stringify({
                    success: false,
                    message:
                        "Could not verify payment with Ziina."
                })
            };
        }

        // --------------------------------------------------
        // 3. Payment must be COMPLETED
        // --------------------------------------------------

        if (
            payment.status !== "completed"
        ) {
            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: false,
                    paid: false,
                    status:
                        payment.status,
                    message:
                        "Payment is not completed."
                })
            };
        }

        // --------------------------------------------------
        // 4. Verify payment amount
        // --------------------------------------------------

        const expectedAmount =
            Math.round(
                Number(session.total) * 100
            );

        const paidAmount =
            Number(payment.amount);

        if (
            paidAmount !==
            expectedAmount
        ) {
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
                    message:
                        "Payment amount could not be verified."
                })
            };
        }

        // --------------------------------------------------
        // 5. Check whether this payment already
        //    created an order
        // --------------------------------------------------

        const existingOrderResponse =
            await fetch(
                `${supabaseUrl}/rest/v1/orders?ziina_payment_id=eq.${encodeURIComponent(session.payment_intent_id)}&select=id`,
                {
                    method: "GET",
                    headers: supabaseHeaders
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
                    message:
                        "Could not check order status."
                })
            };
        }

        const existingOrders =
            await existingOrderResponse.json();

        if (
            existingOrders.length > 0
        ) {
            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: true,
                    paid: true,
                    already_created: true,
                    order_id:
                        existingOrders[0].id,
                    payment_intent_id:
                        session.payment_intent_id,
                    total:
                        session.total
                })
            };
        }

        // --------------------------------------------------
        // 6. Decrease stock
        // --------------------------------------------------

        const stockResponse =
            await fetch(
                `${supabaseUrl}/rest/v1/rpc/decrease_stock_for_checkout`,
                {
                    method: "POST",
                    headers:
                        supabaseHeaders,
                    body:
                        JSON.stringify({
                            p_checkout_session_id:
                                sessionId
                        })
                }
            );

        const stockResult =
            await stockResponse.json();

        if (
            !stockResponse.ok ||
            stockResult !== true
        ) {
            console.error(
                "Stock decrease failed:",
                stockResult
            );

            return {
                statusCode: 409,
                body: JSON.stringify({
                    success: false,
                    message:
                        "Payment was verified, but the product is no longer available."
                })
            };
        }

        // --------------------------------------------------
        // 7. Create permanent order
        // --------------------------------------------------

        const orderResponse =
            await fetch(
                `${supabaseUrl}/rest/v1/orders`,
                {
                    method: "POST",
                    headers: {
                        ...supabaseHeaders,
                        "Prefer":
                            "return=representation"
                    },
                    body:
                        JSON.stringify({
                            customer_name:
                                session.customer_name,

                            phone:
                                session.phone,

                            email:
                                session.email,

                            address:
                                session.address,

                            city:
                                session.city,

                            emirate:
                                session.emirate,

                            notes:
                                session.notes,

                            items:
                                session.items,

                            subtotal:
                                session.subtotal,

                            delivery_fee:
                                session.delivery_fee,

                            total:
                                session.total,

                            payment_status:
                                "paid",

                            ziina_payment_id:
                                session.payment_intent_id,

                            created_at:
                                new Date().toISOString()
                        })
                }
            );

        const orderResult =
            await orderResponse.json();

        if (!orderResponse.ok) {
            console.error(
                "Supabase order creation failed:",
                orderResult
            );

            return {
                statusCode: 500,
                body: JSON.stringify({
                    success: false,
                    message:
                        "Payment was verified, but the order could not be saved."
                })
            };
        }

        const order =
            orderResult[0];

        // --------------------------------------------------
        // 8. Mark checkout session completed
        // --------------------------------------------------

        await fetch(
            `${supabaseUrl}/rest/v1/checkout_sessions?id=eq.${encodeURIComponent(sessionId)}`,
            {
                method: "PATCH",
                headers:
                    supabaseHeaders,
                body:
                    JSON.stringify({
                        status:
                            "completed"
                    })
            }
        );

        // --------------------------------------------------
        // 9. Return receipt information
        // --------------------------------------------------

        return {
            statusCode: 200,

            body:
                JSON.stringify({
                    success:
                        true,

                    paid:
                        true,

                    already_created:
                        false,

                    order_id:
                        order.id,

                    payment_intent_id:
                        session.payment_intent_id,

                    customer_name:
                        session.customer_name,

                    address:
                        session.address,

                    city:
                        session.city,

                    emirate:
                        session.emirate,

                    items:
                        session.items,

                    subtotal:
                        session.subtotal,

                    delivery_fee:
                        session.delivery_fee,

                    total:
                        session.total,

                    created_at:
                        order.created_at
                })
        };

    } catch (error) {

        console.error(
            "Complete order error:",
            error
        );

        return {
            statusCode: 500,

            body:
                JSON.stringify({
                    success:
                        false,

                    message:
                        "Something went wrong while completing the order."
                })
        };
    }
};
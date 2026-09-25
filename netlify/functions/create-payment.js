
const { randomUUID } = require("crypto");

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

        const cart = Array.isArray(data.cart) ? data.cart : [];
        const customer = data.customer || {};

        if (cart.length === 0) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    success: false,
                    message: "Your cart is empty."
                })
            };
        }

        // Basic customer validation
        if (
            !customer.name ||
            !customer.phone ||
            !customer.address ||
            !customer.city
        ) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    success: false,
                    message: "Please complete your delivery information."
                })
            };
        }

        // These are our current test-store products.
        // Later we will move products into the database.
        const products = {
            1: {
                name: "Product 1",
                price: 25
            },
            2: {
                name: "Product 2",
                price: 40
            },
            3: {
                name: "Product 3",
                price: 75
            }
        };

        let subtotal = 0;
        const verifiedItems = [];

        for (const item of cart) {
            const product = products[item.id];
            const quantity = Number(item.quantity);

            if (
                !product ||
                !Number.isInteger(quantity) ||
                quantity < 1
            ) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({
                        success: false,
                        message: "Invalid cart."
                    })
                };
            }

            const itemTotal = product.price * quantity;

            subtotal += itemTotal;

            verifiedItems.push({
                id: item.id,
                name: product.name,
                price: product.price,
                quantity: quantity,
                total: itemTotal
            });
        }

        // Current test delivery fee
        const deliveryFee = 10;

        const total = subtotal + deliveryFee;

        // Ziina uses fils.
        const amountInFils = Math.round(total * 100);

        // Create a random private checkout-session ID.
        const sessionId = randomUUID();

        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const ziinaApiKey = process.env.ZIINA_API_KEY;

        if (!supabaseUrl || !supabaseKey || !ziinaApiKey) {
            console.error("Required environment variables are missing.");

            return {
                statusCode: 500,
                body: JSON.stringify({
                    success: false,
                    message: "Server configuration is incomplete."
                })
            };
        }

        // --------------------------------------------------
        // 1. Create temporary checkout session in Supabase
        // --------------------------------------------------

        const sessionResponse = await fetch(
            `${supabaseUrl}/rest/v1/checkout_sessions`,
            {
                method: "POST",
                headers: {
                    "apikey": supabaseKey,
                    "Authorization": `Bearer ${supabaseKey}`,
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal"
                },
                body: JSON.stringify({
                    id: sessionId,
                    customer_name: customer.name,
                    phone: customer.phone,
                    email: customer.email || null,
                    address: customer.address,
                    city: customer.city,
                    notes: customer.notes || null,
                    items: verifiedItems,
                    subtotal: subtotal,
                    delivery_fee: deliveryFee,
                    total: total,
                    status: "pending"
                })
            }
        );

        if (!sessionResponse.ok) {
            const sessionError = await sessionResponse.text();

            console.error(
                "Supabase checkout session error:",
                sessionError
            );

            return {
                statusCode: 500,
                body: JSON.stringify({
                    success: false,
                    message: "Could not create checkout session."
                })
            };
        }

        // --------------------------------------------------
        // 2. Create Ziina Payment Intent
        // --------------------------------------------------

        const siteUrl = `https://${event.headers.host}`;

        const response = await fetch(
            "https://api-v2.ziina.com/api/payment_intent",
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${ziinaApiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    amount: amountInFils,
                    currency_code: "AED",
                    message: "My Store order",

                    success_url:
                        `${siteUrl}/payment-success.html?session_id=${sessionId}`,

                    cancel_url:
                        `${siteUrl}/payment-cancelled.html?session_id=${sessionId}`,

                    failure_url:
                        `${siteUrl}/payment-failed.html?session_id=${sessionId}`,

                    test: true,
                    allow_tips: false
                })
            }
        );

        const result = await response.json();

        if (!response.ok) {
            console.error("Ziina error:", result);

            // Mark the temporary session as failed.
            await fetch(
                `${supabaseUrl}/rest/v1/checkout_sessions?id=eq.${sessionId}`,
                {
                    method: "PATCH",
                    headers: {
                        "apikey": supabaseKey,
                        "Authorization": `Bearer ${supabaseKey}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        status: "failed"
                    })
                }
            );

            return {
                statusCode: response.status,
                body: JSON.stringify({
                    success: false,
                    message: "Ziina could not create the payment."
                })
            };
        }

        // --------------------------------------------------
        // 3. Connect our session to the Ziina payment
        // --------------------------------------------------

        const paymentIntentId = result.id;

        const updateResponse = await fetch(
            `${supabaseUrl}/rest/v1/checkout_sessions?id=eq.${sessionId}`,
            {
                method: "PATCH",
                headers: {
                    "apikey": supabaseKey,
                    "Authorization": `Bearer ${supabaseKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    payment_intent_id: paymentIntentId
                })
            }
        );

        if (!updateResponse.ok) {
            console.error(
                "Could not save Ziina payment ID to checkout session."
            );

            return {
                statusCode: 500,
                body: JSON.stringify({
                    success: false,
                    message: "Could not connect payment to checkout."
                })
            };
        }

        // --------------------------------------------------
        // 4. Send payment information back to checkout page
        // --------------------------------------------------

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                session_id: sessionId,
                payment_intent_id: paymentIntentId,
                redirect_url: result.redirect_url
            })
        };

    } catch (error) {
        console.error("Create payment error:", error);

        return {
            statusCode: 500,
            body: JSON.stringify({
                success: false,
                message: "Something went wrong while creating the payment."
            })
        };
    }
};

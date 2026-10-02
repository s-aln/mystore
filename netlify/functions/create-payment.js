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

        const cart =
            Array.isArray(data.cart)
                ? data.cart
                : [];

        const customer =
            data.customer || {};

        if (cart.length === 0) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    success: false,
                    message: "Your cart is empty."
                })
            };
        }

        // --------------------------------------------------
        // 1. Validate customer information
        // --------------------------------------------------

        if (
            !customer.name ||
            !customer.phone ||
            !customer.address ||
            !customer.city ||
            !customer.emirate
        ) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    success: false,
                    message:
                        "Please complete your delivery information."
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
            console.error(
                "Required environment variables are missing."
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
            "Authorization":
                `Bearer ${supabaseKey}`,
            "Content-Type":
                "application/json"
        };

        // --------------------------------------------------
        // 2. Load active products from Supabase
        // --------------------------------------------------

        const productResponse =
            await fetch(
                `${supabaseUrl}/rest/v1/products?active=eq.true&order=id.asc`,
                {
                    method: "GET",
                    headers: supabaseHeaders
                }
            );

        const productRows =
            await productResponse.json();

        if (!productResponse.ok) {
            console.error(
                "Supabase product lookup error:",
                productRows
            );

            return {
                statusCode: 500,
                body: JSON.stringify({
                    success: false,
                    message:
                        "Could not check product stock."
                })
            };
        }

        const products = {};

        for (const product of productRows) {
            products[product.id] = product;
        }

        // --------------------------------------------------
        // 3. Validate cart and calculate total
        // --------------------------------------------------

        let subtotal = 0;

        const verifiedItems = [];

        for (const item of cart) {

            const product =
                products[item.id];

            const quantity =
                Number(item.quantity);

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

            const stock =
                Number(product.stock);

            if (
                !Number.isInteger(stock) ||
                stock < 0
            ) {
                console.error(
                    "Invalid stock value:",
                    product.id
                );

                return {
                    statusCode: 500,
                    body: JSON.stringify({
                        success: false,
                        message:
                            "Product stock is unavailable."
                    })
                };
            }

            if (stock <= 0) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({
                        success: false,
                        message:
                            `${product.name} is sold out.`
                    })
                };
            }

            if (quantity > stock) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({
                        success: false,
                        message:
                            `Only ${stock} ` +
                            `${product.name}` +
                            `${stock === 1 ? "" : "s"} ` +
                            `remaining.`
                    })
                };
            }

            const price =
                Number(product.price);

            if (
                !Number.isFinite(price) ||
                price < 0
            ) {
                console.error(
                    "Invalid price for product:",
                    product.id
                );

                return {
                    statusCode: 500,
                    body: JSON.stringify({
                        success: false,
                        message:
                            "Product price is unavailable."
                    })
                };
            }

            const itemTotal =
                price * quantity;

            subtotal += itemTotal;

            verifiedItems.push({
                id:
                    product.id,
                name:
                    product.name,
                price:
                    price,
                quantity:
                    quantity,
                total:
                    itemTotal
            });
        }

        const deliveryFee = 0;

        const total =
            subtotal + deliveryFee;

        const amountInFils =
            Math.round(total * 100);

        // --------------------------------------------------
        // 4. Create private checkout session ID
        // --------------------------------------------------

        const sessionId =
            randomUUID();

        // --------------------------------------------------
        // 5. Create temporary checkout session
        // --------------------------------------------------

        const sessionResponse =
            await fetch(
                `${supabaseUrl}/rest/v1/checkout_sessions`,
                {
                    method: "POST",

                    headers: {
                        ...supabaseHeaders,
                        "Prefer":
                            "return=minimal"
                    },

                    body:
                        JSON.stringify({
                            id:
                                sessionId,

                            customer_name:
                                customer.name,

                            phone:
                                customer.phone,

                            email:
                                customer.email || null,

                            address:
                                customer.address,

                            city:
                                customer.city,

                            emirate:
                                customer.emirate,

                            notes:
                                customer.notes || null,

                            items:
                                verifiedItems,

                            subtotal:
                                subtotal,

                            delivery_fee:
                                deliveryFee,

                            total:
                                total,

                            status:
                                "pending"
                        })
                }
            );

        if (!sessionResponse.ok) {

            const sessionError =
                await sessionResponse.text();

            console.error(
                "Supabase checkout session error:",
                sessionError
            );

            return {
                statusCode: 500,
                body: JSON.stringify({
                    success: false,
                    message:
                        "Could not create checkout session."
                })
            };
        }

        // --------------------------------------------------
        // 6. Create Ziina Payment Intent
        // --------------------------------------------------

        const siteUrl =
            `https://${event.headers.host}`;

        const response =
            await fetch(
                "https://api-v2.ziina.com/api/payment_intent",
                {
                    method: "POST",

                    headers: {
                        "Authorization":
                            `Bearer ${ziinaApiKey}`,

                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            amount:
                                amountInFils,

                            currency_code:
                                "AED",

                            message:
                                "Slyde Order",

                            success_url:
                                `${siteUrl}/payment-success.html?session_id=${sessionId}`,

                            cancel_url:
                                `${siteUrl}/payment-cancelled.html?session_id=${sessionId}`,

                            failure_url:
                                `${siteUrl}/payment-failed.html?session_id=${sessionId}`,

                            test:
                                false,

                            allow_tips:
                                false
                        })
                }
            );

        const result =
            await response.json();

        if (!response.ok) {

            console.error(
                "Ziina error:",
                result
            );

            await fetch(
                `${supabaseUrl}/rest/v1/checkout_sessions?id=eq.${encodeURIComponent(sessionId)}`,
                {
                    method: "PATCH",

                    headers:
                        supabaseHeaders,

                    body:
                        JSON.stringify({
                            status:
                                "failed"
                        })
                }
            );

            return {
                statusCode:
                    response.status,

                body:
                    JSON.stringify({
                        success:
                            false,

                        message:
                            "Ziina could not create the payment."
                    })
            };
        }

        // --------------------------------------------------
        // 7. Save Ziina payment ID
        // --------------------------------------------------

        const paymentIntentId =
            result.id;

        if (!paymentIntentId) {

            console.error(
                "Ziina did not return a payment intent ID."
            );

            await fetch(
                `${supabaseUrl}/rest/v1/checkout_sessions?id=eq.${encodeURIComponent(sessionId)}`,
                {
                    method: "PATCH",

                    headers:
                        supabaseHeaders,

                    body:
                        JSON.stringify({
                            status:
                                "failed"
                        })
                }
            );

            return {
                statusCode: 500,

                body:
                    JSON.stringify({
                        success:
                            false,

                        message:
                            "Ziina did not return a valid payment."
                    })
            };
        }

        const updateResponse =
            await fetch(
                `${supabaseUrl}/rest/v1/checkout_sessions?id=eq.${encodeURIComponent(sessionId)}`,
                {
                    method: "PATCH",

                    headers:
                        supabaseHeaders,

                    body:
                        JSON.stringify({
                            payment_intent_id:
                                paymentIntentId
                        })
                }
            );

        if (!updateResponse.ok) {

            console.error(
                "Could not save Ziina payment ID to checkout session."
            );

            return {
                statusCode: 500,

                body:
                    JSON.stringify({
                        success:
                            false,

                        message:
                            "Could not connect payment to checkout."
                    })
            };
        }

        // --------------------------------------------------
        // 8. Send payment information back
        // --------------------------------------------------

        return {
            statusCode: 200,

            body:
                JSON.stringify({
                    success:
                        true,

                    session_id:
                        sessionId,

                    payment_intent_id:
                        paymentIntentId,

                    redirect_url:
                        result.redirect_url
                })
        };

    } catch (error) {

        console.error(
            "Create payment error:",
            error
        );

        return {
            statusCode: 500,

            body:
                JSON.stringify({
                    success:
                        false,

                    message:
                        "Something went wrong while creating the payment."
                })
        };
    }
};
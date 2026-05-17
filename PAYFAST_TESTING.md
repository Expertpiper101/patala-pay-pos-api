# PayFast Online Testing

PayFast requires stable public HTTPS URLs for browser returns and ITN/webhook notifications.

For the hosted webstore, use:

```text
PUBLIC_STORE_URL=https://patala-pay-webstore.vercel.app
```

After the API is deployed, set:

```text
PUBLIC_API_URL=https://patala-pay-pos-api.vercel.app
```

The generated PayFast checkout uses:

```text
return_url = PUBLIC_STORE_URL + "/#payment-success"
cancel_url = PUBLIC_STORE_URL + "/#payment-cancelled"
notify_url = PUBLIC_API_URL + "/store/payfast/itn"
```

## Vercel Environment Variables

Set these in the POS API Vercel project:

```text
PUBLIC_API_URL=https://patala-pay-pos-api.vercel.app
PUBLIC_STORE_URL=https://patala-pay-webstore.vercel.app
SIMPLE_POS_ALLOWED_ORIGINS=https://patala-pay-webstore.vercel.app
PAYFAST_MODE=sandbox
PAYFAST_MERCHANT_ID=10000100
PAYFAST_MERCHANT_KEY=46f0cd694581a
PAYFAST_PASSPHRASE=
PAYFAST_REQUIRE_SIGNATURE=0
```

For live PayFast, replace the sandbox merchant values, set `PAYFAST_MODE=live`, and configure the passphrase/signature settings to match the PayFast merchant account.

## Important Storage Note

The Vercel API deployment uses temporary serverless file storage for testing. That is enough to confirm the webstore, order creation, and PayFast redirect path, but it is not permanent production storage.

Before using the webstore for real customer orders, move the API data layer to a persistent database.

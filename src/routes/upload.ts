import { Elysia } from 'elysia';
import { bearer } from '@elysiajs/bearer';
import crypto from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { HttpRequest } from '@aws-sdk/protocol-http';

const s3Client = new S3Client({
    region: 'auto',
    endpoint: 'https://fly.storage.tigris.dev',
    credentials: {
        accessKeyId: env.S3_ACCESS_KEY as string || '',
        secretAccessKey: env.S3_SECRET_KEY as string || '',
    },
});

const addCustomHeaderMiddleware = (preferredRegion: string) => (next: any) => async (args: any) => {
    if (HttpRequest.isInstance(args.request)) {
        args.request.headers['X-Tigris-Regions'] = preferredRegion;
    }
    return next(args);
};

export const uploadEndpoint = new Elysia({ prefix: "/upload" }).use(bearer()).post("/", async ({ body, bearer }) => {
        if (!bearer) {
            return new Response('Unauthorized', {status: 401});
        }

        if (!body.file) {
            return new Response('No file provided', {status: 400});
        }

        const key = bearer.toString();

        const userData = await fetch(`${env.BACKEND_API_ENDPOINT}/getInfoFromKey?key=${env.BACKEND_SIGNING_KEY}&apiKey=${key}`, {
            method: 'GET',
        });

        if (!userData.ok) {
            return new Response('Unauthorized', {status: 401});
        }

        const json = await userData.json() as {
            id: string,
            plan: string,
            preferredRegion: string,
            usedStorage: number,
            totalStorage: number,
            allowDiscordPrefetch: boolean,
        }
        const preferredRegion = json.preferredRegion;

        // Add middleware to the S3 client with preferredRegion
        s3Client.middlewareStack.add(addCustomHeaderMiddleware(preferredRegion), {
            step: 'build',
        });

        const file = body.file;
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const fileIdString = `${crypto.randomBytes(16).toString('hex')}`;
        const fileId = `${fileIdString}.${file.name.split('.').pop()}`;

        let uploadLimit = 0;

        if (json.plan === 'FREE') {
            uploadLimit = 2 * 1024 * 1024;
        } else if (json.plan === 'ProLite') {
            uploadLimit = 25 * 1024 * 1024;
        } else if (json.plan === 'ProStd') {
            uploadLimit = 50 * 1024 * 1024;
        } else if (json.plan === 'ProUlt') {
            uploadLimit = 100 * 1024 * 1024;
        }

        if (buffer.length > uploadLimit) {
            return new Response('Filesize exceeds plan limit', {status: 413});
        }

        const usedStorage = json.usedStorage * 1024 * 1024;
        const totalStorage = json.totalStorage * 1024 * 1024;

        if (usedStorage + buffer.length > totalStorage) {
            return new Response('Storage limit exceeded', {status: 402});
        }

        try {
            const uploadParams = {
                Bucket: 'sukushocloud',
                Key: `${json.id}/${fileId}`,
                Body: buffer,
                ContentType: file.type,
            };

            const command = new PutObjectCommand(uploadParams);
            await s3Client.send(command);

            const rawUrl = `https://sukushocloud.mdusercontent.com/${json.id}/${fileId}`;
            const viewUrl = `https://view.sukusho.cloud/${fileIdString}`;
            const deleteUrl = `https://sukusho.cloud/delete/${fileIdString}`;

            const sid = crypto.randomBytes(3).toString('hex');

            await fetch('https://sksh.me/api/add', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${env.SHORTFLARE_API_KEY}`,
                },
                body: JSON.stringify({
                    slug: sid,
                    destination: viewUrl,
                }),
            });

            const shortUrl = `https://sksh.me/${sid}`;

            if (json.allowDiscordPrefetch) {
                await fetch(env.DISCORD_WEBHOOK_URL || "", {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        content: `New file uploaded by ${json.id} - ${shortUrl}`,
                    }),
                });
            }

            const dbRes = await fetch(`${env.BACKEND_API_ENDPOINT}/addImage?key=${env.BACKEND_SIGNING_KEY}&id=${json.id}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    url: rawUrl,
                    size: buffer.length / (1024 * 1024),
                    fileId: fileIdString,
                    name: fileId,
                    shortUrl,
                }),
            });

            if (!dbRes.ok) {
                console.error(await dbRes.text());
                return new Response('Error uploading file', {status: 500});
            }

            return new Response(JSON.stringify({
                rawUrl,
                viewUrl,
                shortUrl,
                deleteUrl,
            }), {
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        } catch
            (e) {
            console.error(e);
            return new Response('Error uploading file', {status: 500});
        }
    });
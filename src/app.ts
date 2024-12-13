import Elysia, {redirect} from "elysia";
import { swagger } from "@elysiajs/swagger";
import { cors } from "@elysiajs/cors";
import { uploadEndpoint } from "./routes/upload";

export const app = new Elysia({ aot: false }).onError(({ code, error }) => {
    return new Response(JSON.stringify({ error: error.toString() ?? code }), {
        status: 500,
    });
});

app.use(
    swagger({
        documentation: {
            info: {
                title: "sukushocloud Public API",
                version: "1.0.0"
            },
        },
    }),
);
app.use(cors());

app.use(uploadEndpoint);

app.get("/", () => redirect("https://sukusho.cloud/"));
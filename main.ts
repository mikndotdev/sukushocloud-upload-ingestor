import { Elysia } from 'elysia';

const app = new Elysia()

app.get('/', (req: any, res: any) => {
  return new Response('ちんこ')
})

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server is running on port ${process.env.PORT || 3000}`)
})

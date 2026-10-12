// Os testes de banco usam TEST_DATABASE_URL (um Postgres descartável com as migrações aplicadas).
// Sem ela, só os testes puros rodam; a URL fictícia evita que o Prisma reclame ao ser importado.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://ninguem:ninguem@127.0.0.1:1/inexistente';

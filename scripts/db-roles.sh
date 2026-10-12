#!/bin/sh
# Cria (ou atualiza a senha de) severino_app, o papel que o bot usa no Postgres: só lê e grava dados.
# Estrutura (tabelas, colunas) só muda pelas migrações, que rodam com o dono do banco.
# Roda depois de cada `prisma migrate deploy` e pode ser repetido à vontade.
set -eu

: "${APP_DB_PASSWORD:?defina APP_DB_PASSWORD}"
case "$APP_DB_PASSWORD" in
	*[!A-Za-z0-9]*) echo "APP_DB_PASSWORD deve ter só letras e números" >&2; exit 1 ;;
esac

node node_modules/prisma/build/index.js db execute --stdin --schema prisma/schema.prisma <<SQL
DO \$\$
BEGIN
	IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'severino_app') THEN
		CREATE ROLE severino_app LOGIN PASSWORD '${APP_DB_PASSWORD}';
	ELSE
		ALTER ROLE severino_app WITH LOGIN PASSWORD '${APP_DB_PASSWORD}';
	END IF;
	EXECUTE format('GRANT CONNECT ON DATABASE %I TO severino_app', current_database());
END
\$\$;
GRANT USAGE ON SCHEMA public TO severino_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO severino_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO severino_app;
REVOKE ALL ON "_prisma_migrations" FROM severino_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO severino_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO severino_app;
SQL

echo "Papel severino_app pronto."

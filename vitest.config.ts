import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		setupFiles: ['test/setup.ts'],
		// Os testes de banco compartilham o mesmo Postgres; rodar um arquivo por vez evita interferência.
		fileParallelism: false
	}
});

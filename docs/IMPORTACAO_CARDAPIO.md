# Importação de cardápio (`menu:import`)

Importa um cardápio extraído de outra plataforma (hoje: Brendi, ver `importacao-brendi/`) para
**um restaurante que já existe** no SaaS. Comando administrativo de terminal, sem rota HTTP: quem
roda já tem o `DATABASE_URL`.

## Regras de segurança

- **Simula por padrão.** Sem `--aplicar` nada é gravado: mostra o plano e grava um relatório.
- **Gravar exige confirmar o alvo duas vezes:** `--confirmar-banco <nome do banco>` (conferido
  também com `current_database()` no servidor) e `--confirmar-restaurante <slug>`.
- **Nunca cria nem apaga restaurantes**, nunca mexe em pedidos, caixa, estoque ou receitas, nunca
  toca outro restaurante (tudo é filtrado pelo `tenantId` do slug informado).
- **Uma transação:** ou tudo é gravado, ou nada.
- **Idempotente:** cada item importado guarda `externalId = "<plataforma>:<id de origem>"`. Rodar de
  novo só atualiza o que mudou na fonte; a segunda execução sem mudanças mostra "sem mudança" em tudo.
- **Sem duplicatas e sem sobrescrever o que foi feito à mão:** um item criado manualmente com o
  mesmo nome (sem diferenciar maiúsculas, acentos e espaços) é um **CONFLITO** e impede a gravação.
  Só `--adotar-por-nome` atualiza esses itens a partir da fonte, e é preciso pedir.
- **Itens que saíram da fonte** são apenas relatados ("mantido"), nunca apagados.
- **A fonte vence nos itens importados.** Reimportar devolve preço, esgotado, ativo e demais campos
  dos itens importados aos valores do arquivo, desfazendo o que tiver sido mudado no painel. Use a
  importação para migrar; depois que o restaurante passar a cuidar do cardápio pelo painel, não
  repita (ver `importacao-brendi/PLANO_ADMINISTRACAO.md`).
- **Loja (`--incluir-loja`):** a simulação lista só os campos da unidade que mudariam ("loja: sem
  mudança" quando nada muda).
- **Imagens:** só JPEG, PNG ou WebP reconhecidos pelos bytes, até 3 MB, guardadas no banco
  (`media_assets`), uma vez por restaurante (SHA-256). Imagem ausente ou recusada vira aviso; o
  item entra sem foto.
- **Auditoria:** a aplicação grava `MENU_IMPORTED` (e o desfazer, `MENU_IMPORT_UNDONE`) no log de
  auditoria do restaurante, com a fonte, o operador e as contagens.
- **Recuperação:** o relatório de uma aplicação guarda tudo o que foi criado e o valor anterior de
  tudo o que foi alterado; `--desfazer <relatório>` volta atrás (produto ou categoria que já tenha
  pedidos é desativado, não apagado). Antes de importar num ambiente real, faça também um backup do
  banco (`deploy/backup.js`).

## Uso

```
cd apps/api

# 1. Simular (nada é gravado)
pnpm menu:import --arquivo ../../importacao-brendi/dados/cardapio.json --restaurante <slug>

# 2. Aplicar (depois de ler a simulação)
pnpm menu:import --arquivo ../../importacao-brendi/dados/cardapio.json --restaurante <slug> \
  --aplicar --confirmar-banco <banco> --confirmar-restaurante <slug> \
  --relatorio ../../importacao-brendi/execucoes/<data>-aplicacao.json

# 3. Se precisar desfazer
pnpm menu:import --restaurante <slug> --desfazer <relatório da aplicação> \
  --aplicar --confirmar-banco <banco> --confirmar-restaurante <slug>
```

Em produção (imagem Docker): `node dist/src/cli/import-menu.js` com as mesmas opções
(`pnpm menu:import:prod`).

| Opção | Efeito |
| --- | --- |
| `--imagens <pasta>` | Pasta das fotos (padrão: `../imagens` ao lado da pasta do arquivo) |
| `--prefixo <nome>` | Prefixo do `externalId` (padrão: a plataforma da fonte, `brendi`) |
| `--adotar-por-nome` | Atualiza itens feitos à mão com o mesmo nome em vez de acusar conflito |
| `--incluir-loja` | Também logo, capa, horários, WhatsApp, endereço, taxa, entrega grátis e pedido mínimo da unidade principal (sobrescreve; o relatório guarda os valores anteriores) |
| `--cor-marca <#RRGGBB>` | Cor da marca no cardápio público |
| `--relatorio <arquivo>` | Onde gravar o relatório JSON (padrão: pasta atual) |

Códigos de saída: 0 ok; 1 recusado (arquivo inválido, conflito, erro — nada gravado); 2 comando ou
ambiente errado (nada tentado).

## O que é importado

| Fonte | SaaS |
| --- | --- |
| Categorias com produtos publicados | `categories` (ordem da loja) |
| Produtos | `products`: nome, descrição, preço, preço "de" (promoção), esgotado, selos, destaque, foto, ordem |
| Grupos de adicionais e opções | `option_groups` / `option_items`: mínimo, máximo, preço, máximo por opção, esgotado, inativo, foto |
| Grupos de cada produto | `product_option_groups` (só os grupos importados são sincronizados; vínculos feitos à mão ficam) |
| Loja (`--incluir-loja`) | `tenants.logoMediaId/coverMediaId`, e na unidade: horários, WhatsApp, endereço, taxa, grátis a partir de, mínimo |

Não importa (a fonte não tem ou o SaaS não suporta): receitas e estoque, custos, tempo estimado,
agendamento, pausas programadas, taxa por distância, banners, pagamento online. Ver
`importacao-brendi/COMPARACAO.md`.

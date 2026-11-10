# Importação do cardápio da Brendi

Cardápio público da Do'cê Hamburgueria e Confeitaria (Ilicínea/MG), lido em
`https://pedido.brendi.com.br/docehamburgueriaedoceria-ilicinea`.

| Pasta / arquivo | O que é |
| --- | --- |
| `dados/cardapio.json` | Tudo, em formato neutro (loja, categorias, produtos, grupos de adicionais, opções, imagens) |
| `dados/categorias.csv` | Categorias na ordem da loja, com quantos produtos publicados e não publicados |
| `dados/produtos.csv` | Produtos: categoria, ordem, nome, descrição, preço, preço "de", tipo de preço, esgotado, selos, grupos, foto |
| `dados/adicionais.csv` | Opções de cada grupo: preço, máximo por opção, esgotada, mínimo/máximo do grupo |
| `dados/produto-adicionais.csv` | Quais grupos de adicionais cada produto oferece, na ordem |
| `dados/imagens.csv` | Cada foto: arquivo local, tipo, tamanho, SHA-256 e URL de origem |
| `imagens/` | As fotos originais baixadas (não versionadas no Git; ver abaixo) |
| `ferramentas/extrair-brendi.mjs` | O extrator (pode ser rodado de novo para atualizar preços) |
| `COMPARACAO.md` | Brendi × Restaurant SaaS: o que é compatível, o que foi implementado e o que falta |
| `execucoes/` | Relatórios das simulações e importações (não versionados) |

Os CSV usam `;` e acentos em UTF-8 com BOM, para abrir direto no Excel.

## Como os dados foram obtidos

- Um único GET da página pública: o cardápio vem embutido no HTML (bloco `__NUXT_DATA__`),
  exatamente o que qualquer visitante recebe. Nada de login, carrinho ou pedido.
- As fotos são os arquivos originais do armazenamento público usado pela página (um GET por foto).
- A navegação visual (capturas, telas de produto, informações da loja) foi feita num Chrome real,
  com os scripts de análise da página bloqueados.

## Regras da extração

- Preço: centavos, inteiros. Promoção: `precoCentavos` é o cobrado e `precoDeCentavos` o riscado
  ("De R$ 35,00 por R$ 32,00").
- `exibicaoPreco`: `fixo`, `a_partir_de` (algum adicional pago pode aumentar o preço, regra
  observada na página) ou `promocional`.
- `esgotado`: produtos da seção "Em falta" e opções marcadas como faltando (a página as esconde).
- `maisPedido`: os 5 produtos da faixa "Mais Pedidos" (a Brendi calcula por vendas).
- Produtos listados nas categorias mas **não publicados** pela loja (33) não têm dados na página:
  ficam só como contagem em `categorias.csv`. Nada foi inventado para eles.
- Nada de ingredientes, receitas, custos ou estoque: a página não informa e não foi inventado.

## Atualizar a extração

```
node importacao-brendi/ferramentas/extrair-brendi.mjs
```

## Importar para um restaurante do SaaS

Ver `docs/IMPORTACAO_CARDAPIO.md`. Resumo: sempre simular primeiro; gravar só com
`--aplicar --confirmar-banco <banco> --confirmar-restaurante <slug>`; o relatório gerado permite
desfazer.

## Direitos sobre fotos e textos

As fotos e descrições são do restaurante. Foram copiadas para migrar o cardápio do próprio
restaurante para o novo sistema; confirmar com o proprietário antes de publicar. A marca e o código
da Brendi não foram copiados.

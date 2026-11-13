# Ordem dos Traços

Uma página para aprender a escrever chinês. Digite palavras ou frases e cada caractere
aparece num quadrado, agrupado em palavras, com o pinyin em cima e o significado em
inglês embaixo. Depois é só ver os traços sendo escritos, na ordem.

É um site estático: só arquivos, sem servidor. Funciona no GitHub Pages ou em qualquer
hospedagem que sirva arquivos. As animações são feitas pelo
[Hanzi Writer](https://github.com/chanind/hanzi-writer).

## Publicar no GitHub Pages

Você precisa de uma conta no GitHub. O GitHub Pages é grátis para repositórios públicos.

### Pelo navegador, sem git

1. No github.com, clique em **+** no canto superior direito e depois em **New repository**.
   Dê o nome `stroke-order`, deixe como **Public**, ative **Add README** e clique em
   **Create repository**.
2. Na página do repositório, abra **Add file** e escolha **Upload files**.
3. Abra a pasta do projeto no seu computador, selecione tudo o que está dentro dela
   (`index.html`, `app.js`, `style.css`, `README.md` e as pastas `data`, `fonts`, `lib`,
   `tools`) e arraste para a página de upload. Espere todos os arquivos aparecerem na
   lista; `data/dictionary.json` tem 8 MB e é o que mais demora.
4. Clique em **Commit changes**.
5. Vá em **Settings** e depois em **Pages** na barra lateral. Em "Build and deployment",
   coloque **Source** em **Deploy from a branch**, escolha o branch **main** e a pasta
   **/ (root)**, e clique em **Save**.
6. Espere um ou dois minutos (pode levar até dez) e recarregue as configurações do Pages.
   O endereço aparece no topo: `https://SEU-USUARIO.github.io/stroke-order/`.

Para mudar o site depois, envie os arquivos alterados do mesmo jeito. O GitHub publica de
novo sozinho a cada commit.

### Com git

```
cd stroke-order
git init -b main
git add .
git commit -m "Ordem dos Traços"
git remote add origin https://github.com/SEU-USUARIO/stroke-order.git
git push -u origin main
```

Crie antes o repositório vazio no github.com (sem README) e depois siga o passo 5 acima.

### Se algo parecer errado

- **O endereço mostra uma página 404.** A primeira publicação ainda está rodando, ou o
  `index.html` não está no nível de cima do repositório. Ele não pode estar dentro de uma
  pasta no repositório.
- **Os quadrados aparecem, mas sem pinyin e significados.** O `data/dictionary.json` não
  foi enviado. Envie de novo.
- **Falta a linha do radical embaixo dos quadrados.** O `data/radicals.json` não foi
  enviado. Envie de novo.
- **Os quadrados dizem "não carregado".** Não foi possível baixar os traços do jsDelivr.
  Verifique a conexão com a internet e edite o texto para tentar de novo.

## Testar no seu computador

O navegador não deixa uma página aberta direto de uma pasta ler o dicionário, então dar
dois cliques no `index.html` não basta. Sirva a pasta:

```
cd stroke-order
python -m http.server 8000
```

E abra <http://localhost:8000>.

## Como usar

**A caixa de texto.** Digite ou cole chinês. Os quadrados se atualizam enquanto você
digita. Texto que não é chinês (pontuação, anotações) aparece pequeno entre as palavras.
Cada nova linha na caixa começa uma nova fileira de quadrados.

**Assistir.** Dois segundos depois que os quadrados aparecem, os caracteres começam a ser
escritos sozinhos, um traço de cada vez, na ordem de leitura, e recomeçam quando chegam ao
fim. Isso acontece de novo sempre que você muda o texto.

- **Pausar** para no traço em que está; o mesmo botão vira **Reproduzir** para continuar.
  A **barra de espaço** faz o mesmo (fora da caixa de texto).
- **Traço a traço:** ao lado do botão principal, as setas **‹** e **›** (ou as teclas
  **←** e **→**) pausam a escrita e voltam ou avançam um traço de cada vez. Entre as setas
  aparece onde você está, por exemplo "我 3 / 7": o caractere e o traço. **Reproduzir**
  continua a partir dali.
- Clicar num quadrado escreve de novo só aquele caractere; o ▶ redondo embaixo de uma
  palavra escreve só aquela palavra. Enquanto isso, e depois, o botão principal vira
  **Recomeçar tudo**: clique nele para escrever o texto todo de novo, desde o começo.
- A **Velocidade** (Devagar, Normal ou Rápido) fica acima dos quadrados, à direita, e pode
  ser mudada durante a escrita.

**Configurações** (o botão ⚙ ao lado da velocidade). O padrão já serve para quase todo
mundo; aqui ficam as opções:

| Opção | Padrão | O que faz |
| --- | --- | --- |
| Agrupar quadrados por | Palavras | Palavras: 我喜欢学习中文 vira 我 / 喜欢 / 学习 / 中文. Caracteres: cada caractere separado, com o seu próprio significado. |
| Layout do quadrado | 米字格 | 米字格 tem as linhas horizontal, vertical e diagonais; 田字格 só a horizontal e a vertical. |
| Repetir | ligado | Recomeça do início quando chega ao fim. |
| Contorno | ligado | Mostra o caractere clarinho por trás enquanto é escrito. |
| Radical em vermelho | ligado | Pinta de vermelho os traços do radical. |

Embaixo de cada quadrado aparece o número de traços e o radical, em vermelho, com o
significado dele; passe o mouse por cima para ver o pinyin e o significado completo. O
significado da palavra fica embaixo do grupo. São só uma ajuda: o centro da página é a
ordem dos traços.

## Como funciona

```
index.html             a página
style.css              a aparência
app.js                 tudo o que a página faz
data/dictionary.json   palavras com pinyin e significados em inglês (CC-CEDICT)
data/radicals.json     o radical de cada caractere e o significado de cada radical
lib/                   Hanzi Writer 3.7.3
fonts/                 Andika, a fonte do pinyin e da interface
tools/                 os scripts que geram os arquivos de data/ (o site não usa)
.gitignore             arquivos que não devem ir para o repositório (do sistema, de editores)
```

- **Palavras.** O separador de palavras do próprio navegador (`Intl.Segmenter`) corta o
  texto, e o dicionário corrige: pedaços desconhecidos são cortados em palavras do
  dicionário, e pedaços de uma palavra maior do dicionário são juntados de novo. Um
  navegador sem `Intl.Segmenter` usa só o dicionário.
- **Pinyin e significados.** Vêm do `data/dictionary.json`. O arquivo tem 8 MB, cerca de
  3 MB quando a hospedagem o comprime na transferência, como normalmente acontece. Ele é
  baixado na primeira visita e o navegador guarda depois.
- **Radicais.** Vêm do `data/radicals.json` (70 KB), gerado a partir do Make Me a Hanzi,
  a mesma fonte dos traços. Por isso o radical mostrado embaixo é o mesmo pintado de
  vermelho no desenho. Os significados dos radicais ficam em inglês, como no dicionário.
- **Traços.** Os dados de traços de cada caractere são baixados do jsDelivr quando ele
  aparece pela primeira vez, os mesmos arquivos que o Hanzi Writer usa por padrão. Isso
  precisa de internet.

O seu texto e as suas configurações ficam guardados no seu próprio navegador. O texto é
processado ali também. A única coisa que sai da página é o pedido dos traços de cada
caractere, que vai para o jsDelivr.

## Bom saber

- O pinyin é a leitura de dicionário de cada palavra (喜欢 é xǐ huan). Um caractere com
  várias leituras que aparece sozinho recebe a mais comum, então um 行 sozinho é xíng
  mesmo quando se quer dizer háng.
- No máximo 200 caracteres são desenhados de uma vez.
- Cerca de 9.500 caracteres têm dados de traços. Os mais raros aparecem numa fonte comum,
  com a indicação "sem dados de traços".
- A separação de palavras pode variar um pouco entre navegadores, porque cada um traz o
  seu próprio separador.

## Gerar os dados de novo

Só é preciso se você quiser uma versão mais nova das fontes. Veja o começo de
`tools/build_dictionary.py` (dicionário) e de `tools/build_radicals.py` (radicais).

## Créditos e licenças

- [Hanzi Writer](https://github.com/chanind/hanzi-writer) de David Chanin, licença MIT
  (`lib/hanzi-writer.LICENSE.txt`).
- Dados de traços e de radicais do [Make Me a Hanzi](https://github.com/skishore/makemeahanzi),
  derivados das fontes Arphic, sob a Arphic Public License. Os traços são carregados do
  jsDelivr, não ficam guardados aqui; `data/radicals.json` é derivado do
  `dictionary.txt` do mesmo projeto.
- `data/dictionary.json` é derivado do [CC-CEDICT](https://cc-cedict.org/wiki/) e está sob a
  licença [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
  (`data/LICENSE.txt`). Se você compartilhar ou alterar esse arquivo, mantenha este crédito e
  a mesma licença.
- [Andika](https://software.sil.org/andika/) da SIL International, SIL Open Font License
  (`fonts/Andika-OFL.txt`).

const express = require("express");
const axios = require("axios");
const Archiver = require("archiver");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();

app.use(cors());

app.use(express.text({
  limit: "100mb"
}));

const PORT = 3000;

function encontrarUrls(obj) {

  let urls = [];

  function procurar(item) {

    if (
      typeof item === "string" &&
      item.startsWith("http")
    ) {
      urls.push(item);
    }

    else if (Array.isArray(item)) {
      item.forEach(procurar);
    }

    else if (
      typeof item === "object" &&
      item !== null
    ) {
      Object.values(item)
        .forEach(procurar);
    }
  }

  procurar(obj);

  return urls;
}

app.post("/download", async (req, res) => {

  try {

    const data = req.body;

    let urls = [];

    try {

      const json = JSON.parse(data);

      urls = encontrarUrls(json);

    } catch {

      const regex =
        /(https?:\/\/[^\s<]+)/g;

      urls = data.match(regex) || [];
    }

    if (!urls || urls.length === 0) {

      return res.status(400).json({
        erro: "Nenhuma URL encontrada"
      });
    }

    console.log(
      `Total de URLs: ${urls.length}`
    );

    const tempDir =
      path.join(__dirname, "temp");

    if (!fs.existsSync(tempDir)) {

      fs.mkdirSync(tempDir, {
        recursive: true
      });
    }

    const zipName =
      `arquivos-${Date.now()}.zip`;

    const zipPath =
      path.join(tempDir, zipName);

    const output =
      fs.createWriteStream(zipPath);

    const archive = Archiver("zip", {
      zlib: {
        level: 0
      }
    });

    archive.on("error", (err) => {

      console.log("Erro no Archiver");

      console.log(err);

      if (!res.headersSent) {

        res.status(500).json({
          erro: "Erro ao gerar ZIP"
        });
      }
    });

    output.on("error", (err) => {

      console.log("Erro no output");

      console.log(err);

      if (!res.headersSent) {

        res.status(500).json({
          erro: "Erro ao escrever ZIP"
        });
      }
    });

    archive.on("progress", (progress) => {

      console.log(`
========================
ZIP PROGRESS
Arquivos: ${progress.entries.processed}
Tamanho:
${(archive.pointer() / 1024 / 1024).toFixed(2)} MB
========================
`);
    });

    archive.pipe(output);

    let baixados = 0;

    for (const url of urls) {

      try {

        console.log(
          `Baixando ${baixados + 1}/${urls.length}`
        );

        const response = await axios({

          method: "GET",

          url,

          responseType: "stream",

          timeout: 15000,

          maxRedirects: 5,

          validateStatus: () => true
        });

        if (response.status !== 200) {

          console.log(
            `Status inválido: ${response.status}`
          );

          continue;
        }

        let nomeArquivo =
          decodeURIComponent(
            url
              .split("/")
              .pop()
              .split("?")[0]
          );

        if (
          !nomeArquivo ||
          nomeArquivo.length > 150
        ) {

          nomeArquivo =
            `arquivo-${baixados}`;
        }

        nomeArquivo =
          nomeArquivo.replace(
            /[<>:"/\\|?*]/g,
            "_"
          );

        archive.append(
          response.data,
          {
            name: nomeArquivo
          }
        );

        baixados++;

      } catch (err) {

        console.log(
          "Erro ao baixar:"
        );

        console.log(url);

        console.log(err.message);
      }
    }

    if (baixados === 0) {

      return res.status(400).json({
        erro: "Nenhum arquivo foi baixado"
      });
    }

    console.log("Finalizando ZIP...");

    await archive.finalize();

    await new Promise((resolve, reject) => {

      output.on("close", resolve);

      output.on("error", reject);
    });

    console.log(
      `ZIP finalizado:
${(archive.pointer() / 1024 / 1024).toFixed(2)} MB`
    );

    res.download(
      zipPath,
      zipName,
      (err) => {

        if (err) {

          console.log(
            "Erro no download:"
          );

          console.log(err);
        }

        try {

          fs.unlinkSync(zipPath);

          console.log("ZIP removido");

        } catch (e) {

          console.log(
            "Erro ao remover ZIP"
          );
        }
      }
    );

  } catch (err) {

    console.log("ERRO GERAL:");

    console.log(err);

    if (!res.headersSent) {

      res.status(500).json({
        erro: "Erro interno"
      });
    }
  }
});

app.listen(PORT, () => {

  console.log(
    `Servidor rodando em http://localhost:${PORT}`
  );
});
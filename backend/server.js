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

const CONCORRENCIA = 1;

const START_INDEX = 1;

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

async function baixarArquivo(
  url,
  i,
  urls,
  downloadsDir
) {

  try {

    console.log(`
===================================
PROCESSANDO ${i + 1}/${urls.length}
===================================
`);

    const response = await axios({

      method: "GET",

      url,

      responseType: "stream",

      timeout: 20000,

      maxRedirects: 5,

      validateStatus: () => true,

      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    if (response.status !== 200) {

      console.log(
        `STATUS INVÁLIDO: ${response.status}`
      );

      return false;
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
        `arquivo-${i}`;
    }

    nomeArquivo =
      nomeArquivo.replace(
        /[<>:"/\\|?*]/g,
        "_"
      );

    nomeArquivo =
      `${i}-${nomeArquivo}`;

    const filePath =
      path.join(
        downloadsDir,
        nomeArquivo
      );

    if (fs.existsSync(filePath)) {

      console.log(`
ARQUIVO JÁ EXISTE:
${nomeArquivo}
`);

      return true;
    }

    const writer =
      fs.createWriteStream(filePath);

    response.data.pipe(writer);

    await Promise.race([

      new Promise((resolve, reject) => {

        writer.on("finish", resolve);

        writer.on("error", reject);
      }),

      new Promise((_, reject) => {

        setTimeout(() => {

          reject(
            new Error("Timeout writer")
          );

        }, 30000);
      })
    ]);

    return true;

  } catch (err) {

    console.log(`
ERRO:
${url}

${err.message}
`);

    return false;
  }
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

    if (START_INDEX >= urls.length) {

      return res.status(400).json({
        erro:
          "START_INDEX maior que total de URLs"
      });
    }

    console.log(`
===================================
TOTAL DE URLS:
${urls.length}

COMEÇANDO EM:
${START_INDEX}
===================================
`);

    const tempDir =
      path.join(__dirname, "temp");

    fs.mkdirSync(tempDir, {
      recursive: true
    });

    const downloadsDir =
      path.join(tempDir, "downloads");

    fs.mkdirSync(downloadsDir, {
      recursive: true
    });

    let sucessos = 0;
    let erros = 0;

    for (
      let i = START_INDEX;
      i < urls.length;
      i += CONCORRENCIA
    ) {

      const lote =
        urls.slice(
          i,
          i + CONCORRENCIA
        );

      const resultados =
        await Promise.all(

          lote.map((url, index) =>
            baixarArquivo(
              url,
              i + index,
              urls,
              downloadsDir
            )
          )
        );

      resultados.forEach((ok) => {

        if (ok) {
          sucessos++;
        } else {
          erros++;
        }
      });

      console.log(`
===================================
LOTE FINALIZADO

ATÉ:
${Math.min(
  i + CONCORRENCIA,
  urls.length
)}

SUCESSOS:
${sucessos}

ERROS:
${erros}
===================================
`);
    }

    console.log(`
===================================
DOWNLOADS FINALIZADOS

SUCESSOS:
${sucessos}

ERROS:
${erros}
===================================
`);

    if (sucessos === 0) {

      return res.status(400).json({
        erro:
          "Nenhum arquivo foi baixado"
      });
    }

    const zipName =
      `arquivos-${Date.now()}.zip`;

    const zipPath =
      path.join(tempDir, zipName);

    const output =
      fs.createWriteStream(zipPath);

    const archive =
      Archiver("zip", {

        zlib: {
          level: 0
        }
      });

    archive.pipe(output);

    archive.on("progress", (progress) => {

      console.log(`
===================================
ZIP PROGRESS

ARQUIVOS:
${progress.entries.processed}

TAMANHO:
${(
  archive.pointer() /
  1024 /
  1024
).toFixed(2)} MB
===================================
`);
    });

    archive.on("error", (err) => {

      console.log(`
ERRO ZIP
`);

      console.log(err);
    });

    const arquivos =
      fs.readdirSync(downloadsDir);

    for (const arquivo of arquivos) {

      const filePath =
        path.join(
          downloadsDir,
          arquivo
        );

      archive.file(filePath, {
        name: arquivo
      });
    }

    console.log(`
===================================
FINALIZANDO ZIP
===================================
`);

    const monitor =
      setInterval(() => {

        console.log(`
ZIP ATUAL:
${(
  archive.pointer() /
  1024 /
  1024
).toFixed(2)} MB
`);

      }, 5000);

    await archive.finalize();

    await new Promise((resolve, reject) => {

      output.on("close", resolve);

      output.on("error", reject);
    });

    clearInterval(monitor);

    console.log(`
===================================
ZIP FINALIZADO

TAMANHO:
${(
  archive.pointer() /
  1024 /
  1024
).toFixed(2)} MB

SALVO EM:
${zipPath}
===================================
`);

    res.download(
      zipPath,
      zipName,
      (err) => {

        if (err) {

          console.log(err);
        }

        console.log(`
===================================
DOWNLOAD ENVIADO

NENHUM ARQUIVO FOI APAGADO
===================================
`);
      }
    );

  } catch (err) {

    console.log(`
===================================
ERRO GERAL
===================================
`);

    console.log(err);

    if (!res.headersSent) {

      res.status(500).json({
        erro: "Erro interno"
      });
    }
  }
});

app.listen(PORT, () => {

  console.log(`
===================================
SERVIDOR:
http://localhost:${PORT}
===================================
`);
});
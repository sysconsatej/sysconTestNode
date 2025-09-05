const fs = require("fs");

function deleteImageHandler(imageName) {
  const imagePath = "." + imageName;
  if (fs.existsSync(imagePath)) {
    console.log("file exists, deleting...");
    fs.unlink(imagePath, (err) => {
      if (err) console.log("Error deleting old file:", err.message);
      else
        console.log("file deleted successfully"),
          console.log("imagePath", imagePath);
    });
  } else {
    console.log("imagePath", imagePath);
    console.log("file does not exist!");
  }
}

module.exports = { deleteImageHandler };

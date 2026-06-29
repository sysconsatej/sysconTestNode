const axios = require("axios");

const URL = "http://localhost:4016/api/test";

async function burst() {
    const promises = [];

    for (let i = 0; i < 1000; i++) {
        promises.push(
            axios.get(URL).catch((err) => err.response?.status)
        );
    }

    const results = await Promise.all(promises);

    console.log(results);
}

burst();
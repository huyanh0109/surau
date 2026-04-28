const axios = require('axios');
async function peek() {
    try {
        const res = await axios.get('http://localhost:1010/api/profiles');
        const profiles = res.data?.data || [];
        if (profiles.length > 0) {
            console.log(JSON.stringify(profiles[0], null, 2));
        } else {
            console.log('No profiles found');
        }
    } catch (err) {
        console.error(err.message);
    }
}
peek();

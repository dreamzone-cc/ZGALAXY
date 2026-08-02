const { MoonService } = require('./dist_engine/services/moonService');

async function main() {
    const res = await MoonService.createMoon({
        name: 'Moon-Alpha',
        endpoints: ['brg-dz.dreamzone.cc/9993', '105.97.148.227/9993']
    });
    console.log('MOON CREATED SUCCESSFULLY:', res);
}

main().catch(console.error);

import { Runtime } from '@helix/runtime';
import { RuntimeEventBus } from '@helix/events';

// 1. 创建 event bus（监听 runtime 生命周期）
const bus = new RuntimeEventBus<{
    'runtime:start': any;
    'runtime:processed': any;
    'runtime:end': any;
    'runtime:error': any;
}>();

bus.on('runtime:start', (e) => {
    console.log('[event:start]', e);
});

bus.on('runtime:processed', (e) => {
    console.log('[event:processed]', e);
});

bus.on('runtime:end', (e) => {
    console.log('[event:end]', e);
});

// 2. 创建 runtime
const runtime = new Runtime({
    eventBus: bus,
});

// 3. 执行最小测试
async function main() {
    const result = await runtime.run('hello helix runtime v0.1');

    console.log('\nfinal output:');
    console.log(result);
}

main().catch((err) => {
    console.error(err);
});
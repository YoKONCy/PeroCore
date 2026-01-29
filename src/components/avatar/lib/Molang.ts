export const molangContext: any = {
    query: new Proxy({
        anim_time: 0,
        life_time: 0,
        head_x_rotation: 0,
        head_y_rotation: 0,
        is_sneaking: 0,
        is_moving: 0,
        ground_speed: 0,
        yaw_speed: 0,
        is_on_ground: 1, // Default to on ground // 默认为在地面上
        vertical_speed: 0,
        is_riding: 0,
        is_sprinting: 0,
        is_holding_right: 0,
        is_holding_left: 0
    }, {
        get: (target: any, prop: string) => {
            return prop in target ? target[prop] : 0;
        }
    }),
    variable: new Proxy({}, {
        get: (target: any, prop: string) => {
            return prop in target ? target[prop] : 0;
        },
        set: (target: any, prop: string, value: any) => {
            target[prop] = value;
            return true;
        }
    }),
    temp: new Proxy({}, {
        get: (target: any, prop: string) => {
            return prop in target ? target[prop] : 0;
        },
        set: (target: any, prop: string, value: any) => {
            target[prop] = value;
            return true;
        }
    }),
    control: new Proxy({}, {
        get: (target: any, prop: string) => {
            return prop in target ? target[prop] : 0;
        }
    }),
    math: {
        sin: (deg: number) => Math.sin(deg * Math.PI / 180),
        cos: (deg: number) => Math.cos(deg * Math.PI / 180),
        tan: (deg: number) => Math.tan(deg * Math.PI / 180),
        asin: (x: number) => Math.asin(x) * 180 / Math.PI,
        acos: (x: number) => Math.acos(x) * 180 / Math.PI,
        atan: (x: number) => Math.atan(x) * 180 / Math.PI,
        atan2: (y: number, x: number) => Math.atan2(y, x) * 180 / Math.PI,
        clamp: (val: number, min: number, max: number) => Math.min(Math.max(val, min), max),
        lerp: (a: number, b: number, t: number) => a + (b - a) * t,
        lerprotate: (a: number, b: number, t: number) => {
            // Shortest path interpolation for angles
            // 角度的最短路径插值
            let diff = b - a;
            while (diff > 180) diff -= 360;
            while (diff < -180) diff += 360;
            return a + diff * t;
        },
        abs: Math.abs,
        min: Math.min,
        max: Math.max,
        pow: Math.pow,
        sqrt: Math.sqrt,
        round: Math.round,
        ceil: Math.ceil,
        floor: Math.floor,
        mod: (a: number, b: number) => a % b,
        random: (min: number, max: number) => Math.random() * (max - min) + min,
        die_roll: (num: number, low: number, high: number) => {
            let sum = 0;
            for (let i = 0; i < num; i++) {
                sum += Math.floor(Math.random() * (high - low + 1)) + low;
            }
            return sum;
        },
        die_roll_integer: (num: number, low: number, high: number) => {
             let sum = 0;
            for (let i = 0; i < num; i++) {
                sum += Math.floor(Math.random() * (high - low + 1)) + low;
            }
            return sum;
        }
    }
};

export class Molang {
    cache: Map<string, Function>;

    constructor() {
        this.cache = new Map();
    }

    parse(expression: any) {
        if (typeof expression === 'number') return () => expression;
        if (this.cache.has(expression)) return this.cache.get(expression);

        let jsExpr = expression;
        
        // Handle Bedrock Molang quirks
        // 处理 Bedrock Molang 怪癖
        // 1. Implied return
        // 1. 隐含返回
        // 2. Snake_case variables allowed
        // 2. 允许 Snake_case 变量
        
        // Handle multiple statements
        // 处理多语句
        if (jsExpr.includes(';')) {
             jsExpr = jsExpr.split(';').filter((p: string) => p.trim() !== '').join(',');
        }

        // Handle 'return'
        // 处理 'return'
        if (jsExpr.startsWith('return ')) {
            jsExpr = jsExpr.substring(7);
        }

        try {
            // Create function with context aliases
            // 创建带有上下文别名的函数
            // Avoids regex replacement for v., q., etc.
            // 避免对 v., q. 等进行正则替换
            const funcBody = `
                const query = context.query;
                const q = context.query;
                const variable = context.variable;
                const v = context.variable;
                const V = context.variable; // Alias V for capital usage // 别名 V
                const temp = context.temp;
                const t = context.temp;
                const T = context.temp; // Alias T for capital usage // 别名 T
                const ctrl = context.control; // Add ctrl alias // 别名 ctrl
                const c = context.control;
                const math = context.math;
                const Math = context.math; // Allow capital Math // 允许大写 Math
                const Q = context.query; // Alias Q for capital usage // 别名 Q
                
                try { 
                    return ${jsExpr}; 
                } catch(e) { 
                    return 0; 
                }
            `;
            
            const func = new Function('context', funcBody);
            this.cache.set(expression, func);
            return func;
        } catch (e) {
            console.warn(`Failed to compile Molang: ${expression}`, e);
            return () => 0;
        }
    }

    eval(expression: any) {
        if (typeof expression === 'number') return expression;
        if (!expression) return 0;
        const func = this.parse(expression);
        if (func) {
            return func(molangContext);
        }
        return 0;
    }
}

export const molang = new Molang();

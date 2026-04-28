export const axios = {
    get: async (url: string, options: any = {}) => {
        let timeout: NodeJS.Timeout | null = null;
        let signal: AbortSignal | undefined = undefined;

        if (options.timeout) {
            const controller = new AbortController();
            timeout = setTimeout(() => controller.abort(), options.timeout);
            signal = controller.signal;
        }

        try {
            const res = await fetch(url, { ...options, method: 'GET', signal });
            let data: any = null;
            try { data = await res.json(); } catch { data = await res.text(); }
            
            if (!res.ok) {
                const err: any = new Error(res.statusText || `HTTP error ${res.status}`);
                err.response = { data, status: res.status };
                err.status = res.status;
                throw err;
            }
            return { data, status: res.status };
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    },
    post: async (url: string, body?: any, options: any = {}) => {
        let timeout: NodeJS.Timeout | null = null;
        let signal: AbortSignal | undefined = undefined;

        if (options.timeout) {
            const controller = new AbortController();
            timeout = setTimeout(() => controller.abort(), options.timeout);
            signal = controller.signal;
        }

        try {
            const res = await fetch(url, {
                ...options,
                method: 'POST',
                body: typeof body === 'object' ? JSON.stringify(body) : body,
                headers: {
                    'Content-Type': 'application/json',
                    ...(options.headers || {})
                },
                signal
            });
            
            let data: any = null;
            try { data = await res.json(); } catch { data = await res.text(); }
            
            if (!res.ok) {
                const err: any = new Error(res.statusText || `HTTP error ${res.status}`);
                err.response = { data, status: res.status };
                err.status = res.status;
                throw err;
            }
            return { data, status: res.status };
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    },
    delete: async (url: string, options: any = {}) => {
        let timeout: NodeJS.Timeout | null = null;
        let signal: AbortSignal | undefined = undefined;

        if (options.timeout) {
            const controller = new AbortController();
            timeout = setTimeout(() => controller.abort(), options.timeout);
            signal = controller.signal;
        }

        try {
            const res = await fetch(url, { ...options, method: 'DELETE', signal });
            
            let data: any = null;
            try { data = await res.json(); } catch { data = await res.text(); }
            
            if (!res.ok) {
                const err: any = new Error(res.statusText || `HTTP error ${res.status}`);
                err.response = { data, status: res.status };
                err.status = res.status;
                throw err;
            }
            return { data, status: res.status };
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    }
};

export default axios;

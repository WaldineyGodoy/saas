/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                inter: ['Inter', 'sans-serif'],
            },
            colors: {
                b2w: {
                    blue: '#003366',
                    orange: '#FF6600',
                }
            }
        },
    },
    plugins: [],
}

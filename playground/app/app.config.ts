export default defineAppConfig({
  colorMode: {
    preference: "light", // Options: 'dark', 'light', or 'system'
  },

  ui: {
    colorMode: {
      preference: "light", // Options: 'dark', 'light', or 'system'
    },

    colors: {
      primary: "orange",
      secondary: "pink",
      neutral: "taupe",
    },

    card: {
      defaultVariants: {
        variant: "subtle",
      },
    },
    alert: {
      defaultVariants: {
        variant: "subtle",
      },
    },
    empty: {
      defaultVariants: {
        variant: "subtle",
      },
    },
    button: {
      compoundVariants: [
        {
          color: "primary",
          variant: "solid",
          class: "shadow-md shadow-primary/30",
        },
      ],
    },
  },
});

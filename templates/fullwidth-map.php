<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
    <meta charset="<?php bloginfo('charset'); ?>">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Knysna Wards Map - <?php bloginfo('name'); ?></title>
    <?php wp_head(); ?>
    <style>
        html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
        .kwm-fullwidth .kwm-container { display: flex; flex-direction: column; height: 100vh; }
        .kwm-fullwidth #kwm-map { flex: 1; min-height: 0; }
        .kwm-fullwidth { max-width: 100%; padding: 0; box-sizing: border-box; }
        .kwm-fullwidth #kwm-map { border-radius: 0; border-left: none; border-right: none; border-bottom: none; }
    </style>
</head>
<body <?php body_class('kwm-fullwidth-page'); ?>>
    <div class="kwm-fullwidth">
        <?php
        while (have_posts()) :
            the_post();
            the_content();
        endwhile;
        ?>
    </div>
    <?php wp_footer(); ?>
</body>
</html>

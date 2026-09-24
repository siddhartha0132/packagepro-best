-- PS-04 — PackagePro — Dynamic Tour Packages
-- Starter queries. Every one runs as-is against data/PS-04.db.
--
-- CAST(x AS REAL) appears below only for sorting and rough exploration.
-- Never use it for a value you will show someone or add to another value.

-- ==========================================================================
-- 1. One package, decomposed into swappable lines
-- F8 — the whole statement is here. You cannot swap an item inside a pipe-separated string.
-- ==========================================================================
SELECT pc.day_index, pc.slot, pc.component_type, pc.title,
          pc.price_delta, pc.currency, pc.is_optional, pc.is_swappable, pc.swap_group
     FROM package_components pc
    WHERE pc.package_id = (SELECT package_id FROM tour_packages ORDER BY package_id LIMIT 1)
    ORDER BY pc.day_index, pc.slot;

-- ==========================================================================
-- 2. What a component can be swapped for
-- Same swap_group = alternatives for each other. Repricing is base_price plus the deltas you keep.
-- ==========================================================================
SELECT swap_group, component_type, title, price_delta, currency
     FROM package_components
    WHERE swap_group <> '' AND swap_group IN (
          SELECT swap_group FROM package_components
           WHERE swap_group <> '' GROUP BY swap_group HAVING COUNT(*) > 1)
    ORDER BY swap_group LIMIT 20;

-- ==========================================================================
-- 3. Live reprice: base price plus every non-optional delta
-- Explore in SQL, compute in Decimal. Never let a float near a price you will display.
-- ==========================================================================
SELECT tp.name, tp.tier, tp.base_price, tp.currency,
          ROUND(CAST(tp.base_price AS REAL) +
                SUM(CASE WHEN pc.is_optional=0 THEN CAST(pc.price_delta AS REAL) ELSE 0 END), 2)
            AS included_total
     FROM tour_packages tp JOIN package_components pc ON pc.package_id = tp.package_id
    GROUP BY tp.package_id ORDER BY CAST(tp.base_price AS REAL) DESC LIMIT 10;

-- ==========================================================================
-- 4. Guides filtered by language and specialisation — the PS-04 addition
-- languages is a comma-separated list of BCP-47 tags. 'ta' is Tamil.
-- ==========================================================================
SELECT g.display_name, c.name AS city, g.languages, g.specialisation,
          g.years_experience, g.rating, g.day_rate, g.currency
     FROM tour_guides g JOIN cities c ON c.city_id = g.city_id
    WHERE g.languages LIKE '%ta%' AND g.status='active'
    ORDER BY g.rating DESC LIMIT 15;

-- ==========================================================================
-- 5. Is that guide actually free on the date, and at what multiplier
-- "No guide free that day" is a state your UI has to have.
-- ==========================================================================
SELECT g.display_name, ga.for_date, ga.is_available, ga.slots_available,
          ga.price_multiplier
     FROM guide_availability ga JOIN tour_guides g ON g.guide_id = ga.guide_id
    WHERE ga.for_date BETWEEN '2026-09-05' AND '2026-09-12'
    ORDER BY g.display_name, ga.for_date LIMIT 20;

-- ==========================================================================
-- 6. Language preference changes what you recommend
-- Packages declare languages_offered. This is the filter the statement asks you to demonstrate.
-- ==========================================================================
SELECT tp.name, tp.theme, tp.languages_offered, tp.base_price, tp.currency
     FROM tour_packages tp WHERE tp.languages_offered LIKE '%hi%' LIMIT 10;

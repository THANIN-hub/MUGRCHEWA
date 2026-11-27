-- ==========================================================
-- ฐานข้อมูลระบบบริหารจัดการแต้มสมาชิกดิจิทัล ร้านมักอาชีวะ
-- วิทยาลัยอาชีวศึกษามหาสารคาม (MySQL / MariaDB)
-- ==========================================================

CREATE DATABASE IF NOT EXISTS `muk_rcheewa_loyalty` 
CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;

USE `muk_rcheewa_loyalty`;

-- 1. ตาราง users (ข้อมูลสมาชิกและผู้ดูแลระบบ)
CREATE TABLE `users` (
    `user_id` INT AUTO_INCREMENT PRIMARY KEY COMMENT 'รหัสอ้างอิงผู้ใช้ (PK)',
    `username` VARCHAR(50) NOT NULL UNIQUE COMMENT 'ชื่อผู้ใช้งานสำหรับเข้าสู่ระบบ',
    `password` VARCHAR(255) NOT NULL COMMENT 'รหัสผ่าน',
    `full_name` VARCHAR(100) NOT NULL COMMENT 'ชื่อ-นามสกุล',
    `student_id` VARCHAR(20) NULL UNIQUE COMMENT 'รหัสนักศึกษา/รหัสบุคลากร',
    `phone` VARCHAR(15) NULL COMMENT 'เบอร์โทรศัพท์ติดต่อ',
    `role` ENUM('member', 'admin') NOT NULL DEFAULT 'member' COMMENT 'สิทธิ์การใช้งาน',
    `points` INT NOT NULL DEFAULT 0 COMMENT 'แต้มสะสมปัจจุบัน',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'วันที่สมัครสมาชิก',
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `chk_user_points` CHECK (`points` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. ตาราง rewards (รายการของรางวัล)
CREATE TABLE `rewards` (
    `reward_id` INT AUTO_INCREMENT PRIMARY KEY COMMENT 'รหัสของรางวัล (PK)',
    `reward_name` VARCHAR(100) NOT NULL COMMENT 'ชื่อของรางวัล',
    `description` TEXT NULL COMMENT 'รายละเอียดของรางวัล',
    `points_required` INT NOT NULL COMMENT 'จำนวนแต้มที่ใช้แลก',
    `stock` INT NOT NULL DEFAULT 0 COMMENT 'จำนวนของรางวัลคงเหลือ',
    `image_url` VARCHAR(255) NULL COMMENT 'ที่อยู่ไฟล์รูปภาพของรางวัล',
    `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'สถานะการเปิดให้แลก (1=เปิด, 0=ปิด)',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `chk_reward_points` CHECK (`points_required` > 0),
    CONSTRAINT `chk_reward_stock` CHECK (`stock` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. ตาราง point_history (ประวัติการซื้อและสะสมแต้ม)
CREATE TABLE `point_history` (
    `history_id` INT AUTO_INCREMENT PRIMARY KEY COMMENT 'รหัสประวัติการสะสมแต้ม (PK)',
    `user_id` INT NOT NULL COMMENT 'รหัสสมาชิกที่ได้รับแต้ม (FK -> users)',
    `recorded_by` INT NULL COMMENT 'รหัสแอดมินผู้บันทึกยอด (FK -> users)',
    `purchase_amount` DECIMAL(10, 2) NOT NULL COMMENT 'ยอดซื้อสินค้า (บาท)',
    `points_earned` INT NOT NULL COMMENT 'จำนวนแต้มที่ได้รับ',
    `note` VARCHAR(255) NULL COMMENT 'หมายเหตุเพิ่มเติม',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_history_user` FOREIGN KEY (`user_id`) 
        REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_history_admin` FOREIGN KEY (`recorded_by`) 
        REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. ตาราง redemptions (ประวัติและการขอแลกของรางวัล)
CREATE TABLE `redemptions` (
    `redemption_id` INT AUTO_INCREMENT PRIMARY KEY COMMENT 'รหัสรายการแลกของรางวัล (PK)',
    `user_id` INT NOT NULL COMMENT 'รหัสสมาชิกผู้ขอแลก (FK -> users)',
    `reward_id` INT NOT NULL COMMENT 'รหัสของรางวัลที่แลก (FK -> rewards)',
    `approved_by` INT NULL COMMENT 'รหัสแอดมินผู้อนุมัติรายการ (FK -> users)',
    `points_spent` INT NOT NULL COMMENT 'จำนวนแต้มที่ถูกหัก ณ วันที่แลก',
    `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending' COMMENT 'สถานะการแลก',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `fk_redemption_user` FOREIGN KEY (`user_id`) 
        REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_redemption_reward` FOREIGN KEY (`reward_id`) 
        REFERENCES `rewards`(`reward_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_redemption_admin` FOREIGN KEY (`approved_by`) 
        REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. ตาราง settings (ตั้งค่าระบบ)
CREATE TABLE `settings` (
    `setting_key` VARCHAR(50) PRIMARY KEY COMMENT 'ชื่อตัวแปรตั้งค่า (PK)',
    `setting_value` VARCHAR(255) NOT NULL COMMENT 'ค่าที่กำหนด',
    `description` VARCHAR(255) NULL COMMENT 'คำอธิบายการตั้งค่า',
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ข้อมูลตัวอย่างเริ่มต้น (Seed Data)
INSERT INTO `settings` (`setting_key`, `setting_value`, `description`) VALUES
('baht_per_point', '20', 'จำนวนยอดซื้อ (บาท) ต่อการได้รับ 1 แต้ม'),
('welcome_bonus_points', '5', 'แต้มโบนัสต้อนรับเมื่อสมัครสมาชิกใหม่');

INSERT INTO `users` (`username`, `password`, `full_name`, `student_id`, `role`, `points`) VALUES
('admin', '1234', 'ผู้ดูแลร้านมักอาชีวะ', 'ADMIN-01', 'admin', 0),
('std001', '1234', 'นายกิตติพงษ์ รักเรียน', '66309010001', 'member', 25),
('std002', '1234', 'นางสาวกัญญาภัทร ใจดี', '66309010002', 'member', 12);

INSERT INTO `rewards` (`reward_name`, `description`, `points_required`, `stock`, `image_url`) VALUES
('ส่วนลดเครื่องดื่ม 10 บาท', 'ใช้เป็นส่วนลดเครื่องดื่มทุกเมนูภายในร้านมักอาชีวะ', 10, 50, 'uploads/rewards/discount10.jpg'),
('สมุดโน้ตลายวิทยาลัยอาชีวศึกษามหาสารคาม', 'สมุดปกแข็งพิมพ์ลายพิเศษ ขนาด A5', 20, 15, 'uploads/rewards/notebook.jpg'),
('แก้วน้ำเก็บความเย็นมักอาชีวะ', 'แก้วสแตนเลสเก็บอุณหภูมิ ขนาด 20 ออนซ์', 50, 5, 'uploads/rewards/tumbler.jpg');

INSERT INTO `point_history` (`user_id`, `recorded_by`, `purchase_amount`, `points_earned`, `note`) VALUES
(2, 1, 100.00, 5, 'ซื้อเครื่องดื่มและขนม'),
(2, 1, 400.00, 20, 'สั่งเครื่องดื่มรับรองกิจกรรมแผนก');
